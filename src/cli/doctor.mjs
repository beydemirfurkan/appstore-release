// Answer "is this machine set up correctly" before anything touches an app.
//
// Deliberately never prints a credential — only whether one is present, and
// whether Apple accepts it. The most common failures are an API key created with
// the wrong role and a bundle id pasted into ASC_APP_ID, and neither produces a
// comprehensible error later on.

import { execFileSync } from "node:child_process";

import { createContext } from "../core/context.mjs";
import { Exit } from "../core/status.mjs";
import { Severity } from "../core/findings.mjs";
import { validateConfig } from "../core/requirements.mjs";
import { findConfigPath } from "../core/config.mjs";
import { AscApiError } from "../asc/client.mjs";

const MIN_NODE = [20, 11];

/**
 * @param {{ stdout: any, stderr: any, env: any, cwd: string, config?: string, appId?: string }} io
 */
export async function doctorCommand({ stdout, stderr, env, cwd, config, appId }) {
  /** @type {string[]} */
  const lines = [];
  /** @type {number} */
  let worst = Exit.OK;

  const ok = (label, detail = "") => lines.push(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
  const warn = (label, detail) => lines.push(`· ${label}${detail ? ` — ${detail}` : ""}`);
  /** @param {string} label @param {string} detail @param {number} [code] */
  const bad = (label, detail, code = Exit.CONFIG) => {
    lines.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    worst = Math.max(worst, code);
  };

  // 1. Runtime
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) {
    ok("Node", process.versions.node);
  } else {
    bad("Node", `${process.versions.node} is below the required ${MIN_NODE.join(".")}`);
  }

  // 2. openssl, needed only by the credentials operation
  try {
    const version = execFileSync("openssl", ["version"], { encoding: "utf8" }).trim();
    const legacy = /OpenSSL 3/.test(version);
    ok("openssl", `${version}${legacy ? " (has -legacy, which EAS needs)" : ""}`);
  } catch {
    warn("openssl", "not found — only the credentials operation needs it");
  }

  // 3. Config
  const configPath = findConfigPath({ explicit: config, env, cwd });
  if (!configPath) {
    warn("config", "none found — run `appstore-release init`");
  } else {
    const ctxForConfig = await createContext({ config: configPath, runtime: { env, cwd } }).catch(() => null);
    if (!ctxForConfig) {
      bad("config", `${configPath} could not be parsed`);
    } else {
      const { valid, findings } = validateConfig(ctxForConfig.config);
      if (valid) ok("config", configPath);
      else
        bad("config", `${findings.filter((f) => f.severity === Severity.BLOCKER).length} problem(s) in ${configPath}`);
      for (const f of findings) lines.push(`    ${f.severity === Severity.BLOCKER ? "✗" : "·"} ${f.title}`);
    }
  }

  // 4. Credentials — presence, then whether Apple actually accepts them
  const ctx = await createContext({ credentials: { appId }, config: configPath ?? undefined, runtime: { env, cwd } });
  const credentialFindings = ctx.findings.filter((f) => f.severity === Severity.BLOCKER);
  if (credentialFindings.length) {
    for (const f of credentialFindings) bad(f.title, f.fix);
  } else {
    ok("credentials", "key id, issuer id and private key are all present");

    try {
      // /v1/apps is the cheapest call that proves the JWT is signed correctly and
      // the key has a role that can read anything at all.
      const apps = await ctx.client.get("/v1/apps?limit=1&fields[apps]=name");
      ok("App Store Connect", `authenticated, ${apps.data?.length ? "can list apps" : "no apps visible to this key"}`);
    } catch (e) {
      if (e instanceof AscApiError && e.status === 401) {
        bad("App Store Connect", "401 — the key id, issuer id or private key do not match", Exit.API);
      } else if (e instanceof AscApiError && e.status === 403) {
        bad("App Store Connect", "403 — this key's role is too limited; App Manager is needed", Exit.API);
      } else {
        bad("App Store Connect", e instanceof Error ? e.message : String(e), Exit.API);
      }
    }

    if (!ctx.appId) {
      warn("app id", "ASC_APP_ID is not set — most commands need it. Use `asc_list_apps` or the ASC URL");
    } else {
      try {
        const app = await ctx.client.get(`/v1/apps/${ctx.appId}?fields[apps]=name,bundleId`);
        ok("app", `${app.data.attributes.name} (${app.data.attributes.bundleId})`);
      } catch (e) {
        const status = e instanceof AscApiError ? e.status : 0;
        bad("app", status === 404 ? `no app with id ${ctx.appId} is visible to this key` : String(e), Exit.API);
      }
    }
  }

  const stream = worst === Exit.OK ? stdout : stderr;
  stream.write(lines.join("\n") + "\n");
  return worst;
}
