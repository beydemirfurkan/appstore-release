// Generates a fresh iOS distribution certificate + App Store provisioning profile via
// the API (+ openssl), and writes EAS local-credentials. Fixes stale-EAS-credential builds.
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Status } from "../core/status.mjs";

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
  },
};

export async function run({ client, discovery, config, log, resolvePath, dryRun }) {
  const bundle = await discovery.bundleId(config.bundleId);
  if (!bundle) return { status: Status.ERROR, message: `bundle id not registered on Apple: ${config.bundleId}` };

  const relDir = config.credentials?.outputDir || "./secrets";
  const outDir = resolvePath(relDir, "config.credentials.outputDir");

  // The only operation whose side effects are not HTTP: it shells out to openssl
  // and writes a private key, a .p12 and its password to disk. The client's
  // dry-run guard cannot see any of that, so this one needs its own.
  if (dryRun) {
    return {
      status: Status.PLANNED,
      message: `would issue a distribution certificate and profile into ${relDir}`,
      details: {
        outputDir: outDir,
        bundleId: config.bundleId,
        wouldWrite: ["dist.key", "dist.p12", "profile.mobileprovision", "credentials.json"],
      },
    };
  }

  mkdirSync(outDir, { recursive: true });
  const password = crypto.randomBytes(12).toString("hex");
  const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });
  const owner = (config.review?.contactFirstName || "Developer").replace(/[^\w ]/g, "");

  // 1. Private key + CSR
  sh(
    `openssl req -new -newkey rsa:2048 -nodes -keyout "${outDir}/dist.key" -out "${outDir}/dist.csr" -subj "/CN=${(config.metadata?.name || "App").replace(/[^\w ]/g, "")} Distribution/O=${owner}/C=US"`,
  );
  const csrContent = readFileSync(`${outDir}/dist.csr`, "utf8");

  // 2. Distribution certificate
  const cert = (
    await client.post(`/v1/certificates`, {
      data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent } },
    })
  ).data;
  writeFileSync(`${outDir}/dist.cer`, Buffer.from(cert.attributes.certificateContent, "base64"));

  // 3. .p12 (legacy PBE for EAS/node compatibility)
  sh(`openssl x509 -inform DER -in "${outDir}/dist.cer" -out "${outDir}/dist.pem"`);
  sh(
    `openssl pkcs12 -export -legacy -inkey "${outDir}/dist.key" -in "${outDir}/dist.pem" -out "${outDir}/dist.p12" -passout pass:${password} -name "Distribution"`,
  );

  // 4. App Store provisioning profile bound to the new cert
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
  writeFileSync(`${outDir}/profile.mobileprovision`, Buffer.from(profile.attributes.profileContent, "base64"));

  // 5. EAS local credentials
  writeFileSync(
    resolvePath("credentials.json", "the EAS credentials file"),
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
  );

  return {
    status: Status.CHANGED,
    message: `cert ${cert.id}, profile ${profile.attributes.uuid} → ${relDir}/; add "credentialsSource":"local" to the eas.json production profile`,
  };
}
