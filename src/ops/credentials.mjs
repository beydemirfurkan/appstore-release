// Issue an iOS distribution certificate and an App Store provisioning profile,
// and write EAS local credentials. Fixes builds that fail on stale EAS credentials.
//
// Two things this operation must never do, both of which it used to:
//   - Consume a certificate slot without being asked. Apple caps an account at
//     three distribution certificates and offers no way back except revoking one,
//     so three runs used to leave someone unable to build at all.
//   - Put user-controlled strings into a shell command line.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { Status } from "../core/status.mjs";
import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";

/** Apple's limit on simultaneous distribution certificates. */
const CERT_CAP = 3;

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "credentials",
  title: "iOS distribution credentials",
  phase: "build",
  needs: ["credentials"],
  mutates: true,
  destructive: true,
  args: {
    allowNewCert: {
      type: "boolean",
      default: false,
      description: "consume one of Apple's three distribution certificate slots",
    },
    reuseCert: {
      type: "string",
      description: "reuse this existing certificate id instead of issuing a new one",
    },
    revoke: {
      type: "string",
      description: "revoke this certificate id and stop",
    },
    list: {
      type: "boolean",
      default: false,
      description: "list the distribution certificates and stop",
    },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ allowNewCert?: boolean, reuseCert?: string, revoke?: string, list?: boolean }} [args]
 */
export async function run({ client, discovery, config, resolvePath, dryRun }, args = {}) {
  const certs = await client.all(
    "/v1/certificates?filter[certificateType]=DISTRIBUTION&fields[certificates]=name,displayName,expirationDate,certificateContent",
    { limit: 200 },
  );
  const describe = (c) =>
    `${c.id} · ${c.attributes.displayName || c.attributes.name} · expires ${c.attributes.expirationDate?.slice(0, 10) ?? "?"}`;

  if (args.list) {
    return {
      status: Status.OK,
      message: `${certs.length}/${CERT_CAP} distribution certificates in use`,
      details: { certificates: certs.map((c) => ({ id: c.id, ...c.attributes, certificateContent: undefined })) },
    };
  }

  if (args.revoke) {
    await client.delete(`/v1/certificates/${args.revoke}`);
    return { status: Status.CHANGED, message: `revoked certificate ${args.revoke}` };
  }

  const bundle = await discovery.bundleId(config.bundleId);
  if (!bundle) return { status: Status.ERROR, message: `bundle id not registered on Apple: ${config.bundleId}` };

  const relDir = config.credentials?.outputDir || "./secrets";
  const outDir = resolvePath(relDir, "config.credentials.outputDir");
  const keyPath = join(outDir, "dist.key");

  // Reuse before issuing. If we already hold the private key for a certificate
  // Apple still trusts, there is nothing to do and no slot to spend.
  const reusable = args.reuseCert
    ? certs.find((c) => c.id === args.reuseCert)
    : existsSync(keyPath)
      ? certs.find((c) => certificateMatchesKey(c, keyPath))
      : null;

  if (!reusable && certs.length >= CERT_CAP && !args.allowNewCert) {
    return {
      status: Status.ERROR,
      message: `${certs.length} of ${CERT_CAP} distribution certificates already exist and none matches a local key`,
      findings: [
        finding({
          id: "credentials.cert.cap-reached",
          severity: Severity.BLOCKER,
          category: Category.ACCOUNT,
          title: "No distribution certificate slots left",
          detail: `Apple allows ${CERT_CAP}. Existing:\n${certs.map((c) => `  ${describe(c)}`).join("\n")}`,
          fixOwner: FixOwner.CLI,
          fix:
            "Reuse one with --reuse-cert <id> (you need its private key), revoke one with --revoke <id>, " +
            "or pass --allow-new-cert if you are certain.",
        }),
      ],
      details: { certificates: certs.map((c) => ({ id: c.id, ...c.attributes, certificateContent: undefined })) },
    };
  }

  // The only operation whose side effects are not HTTP: it shells out to openssl
  // and writes a private key, a .p12 and its password to disk. The client's
  // dry-run guard cannot see any of that, so this one needs its own.
  if (dryRun) {
    return {
      status: reusable ? Status.OK : Status.PLANNED,
      message: reusable
        ? `would reuse certificate ${reusable.id}`
        : `would issue a distribution certificate (${certs.length}/${CERT_CAP} in use) into ${relDir}`,
      details: {
        outputDir: outDir,
        bundleId: config.bundleId,
        reusing: reusable?.id ?? null,
        certificatesInUse: certs.length,
        wouldWrite: ["dist.key", "dist.p12", "profile.mobileprovision", "credentials.json"],
      },
    };
  }

  // 0o700: the directory is about to hold an unencrypted private key.
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const password = crypto.randomBytes(12).toString("hex");
  const openssl = (...argv) => execFileSync("openssl", argv, { stdio: ["ignore", "pipe", "pipe"] });

  let cert = reusable;
  if (!cert) {
    // execFile, not exec: config.metadata.name is user-controlled and used to go
    // into a shell string with only a character-class filter in front of it.
    const commonName = `${sanitize(config.metadata?.name) || "App"} Distribution`;
    const org = sanitize(config.review?.contactFirstName) || "Developer";
    openssl(
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      join(outDir, "dist.csr"),
      "-subj",
      `/CN=${commonName}/O=${org}/C=US`,
    );
    chmod600(keyPath);

    cert = (
      await client.post(`/v1/certificates`, {
        data: {
          type: "certificates",
          attributes: { certificateType: "DISTRIBUTION", csrContent: readFileSync(join(outDir, "dist.csr"), "utf8") },
        },
      })
    ).data;
  }

  writeFileSync(join(outDir, "dist.cer"), Buffer.from(cert.attributes.certificateContent, "base64"));

  // The .p12 needs legacy PBE: OpenSSL 3's default is unreadable by EAS and node.
  openssl("x509", "-inform", "DER", "-in", join(outDir, "dist.cer"), "-out", join(outDir, "dist.pem"));
  const legacy = supportsLegacyPkcs12() ? ["-legacy"] : [];
  openssl(
    "pkcs12",
    "-export",
    ...legacy,
    "-inkey",
    keyPath,
    "-in",
    join(outDir, "dist.pem"),
    "-out",
    join(outDir, "dist.p12"),
    "-passout",
    `pass:${password}`,
    "-name",
    "Distribution",
  );
  chmod600(join(outDir, "dist.p12"));

  const profile = (
    await client.post(`/v1/profiles`, {
      data: {
        type: "profiles",
        attributes: { name: `${config.bundleId} AppStore (auto)`, profileType: "IOS_APP_STORE" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundle.id } },
          certificates: { data: [{ type: "certificates", id: cert.id }] },
        },
      },
    })
  ).data;
  writeFileSync(join(outDir, "profile.mobileprovision"), Buffer.from(profile.attributes.profileContent, "base64"));

  const credentialsPath = resolvePath("credentials.json", "the EAS credentials file");
  writeFileSync(
    credentialsPath,
    JSON.stringify(
      {
        ios: {
          provisioningProfilePath: `${relDir}/profile.mobileprovision`,
          distributionCertificate: { path: `${relDir}/dist.p12`, password },
        },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );

  const findings = [];
  for (const secret of [relDir, "credentials.json"]) {
    if (!isGitIgnored(secret, resolvePath("."))) {
      findings.push(
        finding({
          id: `credentials.gitignore.${secret.replace(/\W+/g, "-")}`,
          severity: Severity.BLOCKER,
          category: Category.ACCOUNT,
          title: `${secret} is not git-ignored`,
          detail: "It now contains a private key or its password.",
          fixOwner: FixOwner.EXTERNAL,
          fix: `Add "${secret}" to .gitignore before committing anything.`,
        }),
      );
    }
  }

  return {
    status: Status.CHANGED,
    message:
      `${reusable ? `reused cert ${cert.id}` : `new cert ${cert.id}`}, profile ${profile.attributes.uuid} → ${relDir}/; ` +
      `add "credentialsSource":"local" to the eas.json production profile`,
    details: { certificateId: cert.id, reused: Boolean(reusable), outputDir: outDir, credentialsPath },
    findings,
  };
}

/** Strip anything that is not a letter, digit, space, dot or hyphen. */
const sanitize = (value) => (typeof value === "string" ? value.replace(/[^\w .-]/g, "").trim() : "");

/** Best effort: Windows and some filesystems have no mode bits. */
function chmod600(path) {
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

/**
 * Does this openssl understand -legacy? OpenSSL 3 defaults to a PBE that EAS and
 * node cannot read; OpenSSL 1.x has neither the flag nor the problem.
 */
function supportsLegacyPkcs12() {
  try {
    return /OpenSSL 3/.test(execFileSync("openssl", ["version"], { encoding: "utf8" }));
  } catch {
    return false;
  }
}

/** Ask git, rather than reimplementing .gitignore semantics. */
function isGitIgnored(path, cwd) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the certificate correspond to the private key we hold? Comparing public
 * keys is the only way to know a certificate is reusable rather than merely present.
 */
function certificateMatchesKey(cert, keyPath) {
  try {
    const der = Buffer.from(cert.attributes.certificateContent, "base64");
    const certPub = new crypto.X509Certificate(der).publicKey.export({ type: "spki", format: "pem" });
    const keyPub = crypto.createPublicKey(readFileSync(keyPath, "utf8")).export({ type: "spki", format: "pem" });
    return certPub.toString() === keyPub.toString();
  } catch {
    return false;
  }
}
