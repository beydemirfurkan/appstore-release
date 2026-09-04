// Composition root. Wire the dependencies once and hand every operation the same
// context — operations never construct their own client or read the environment.
//
// Everything arrives as a parameter. The old version read process.env internally,
// which meant one process could serve exactly one app and nothing could be tested
// without mutating the environment.

import { dirname } from "node:path";

import { resolveCredentials } from "./credentials.mjs";
import { findConfigPath, loadConfig } from "./config.mjs";
import { createLog } from "./events.mjs";
import { resolveProjectPath } from "./paths.mjs";
import { createTokenProvider } from "../asc/jwt.mjs";
import { AscClient, DEFAULT_BASE_URL } from "../asc/client.mjs";
import { Discovery } from "../asc/discovery.mjs";
import { AssetUploader } from "../asc/assets.mjs";

/**
 * @typedef {Object} CreateContextOptions
 * @property {import("./credentials.mjs").AscCredentialsInput} [credentials]
 * @property {object|string} [config]        parsed object, or a path to a JSON file
 * @property {string} [projectRoot]          base for every relative path in the config
 * @property {boolean} [dryRun]
 * @property {(e: any) => void} [onEvent]    structured event sink
 * @property {typeof fetch} [fetchImpl]
 * @property {string} [baseUrl]
 * @property {{ env?: Record<string,string|undefined>, cwd?: string, random?: () => number }} [runtime]
 */

/**
 * @typedef {Object} Context
 * @property {import("./credentials.mjs").AscCredentials} credentials
 * @property {string} appId
 * @property {string} projectRoot
 * @property {string|null} configPath
 * @property {object|null} config
 * @property {AscClient} client
 * @property {Discovery} discovery
 * @property {AssetUploader} uploader
 * @property {boolean} dryRun
 * @property {import("./events.mjs").Log} log
 * @property {import("./findings.mjs").Finding[]} findings
 * @property {(rel: string, purpose?: string) => string} resolvePath
 */

/**
 * Build a context. Missing credentials or config are reported as findings on the
 * returned object rather than thrown, so a caller (the MCP server especially) can
 * start up and explain itself instead of dying at construction time.
 *
 * @param {CreateContextOptions} [options]
 * @returns {Promise<Context>}
 */
export async function createContext(options = {}) {
  const { env = process.env, cwd = process.cwd(), random = Math.random } = options.runtime ?? {};

  const { credentials, findings } = resolveCredentials(options.credentials ?? {}, { env });

  const configSource =
    typeof options.config === "object" && options.config !== null
      ? options.config
      : (options.config ?? findConfigPath({ env, cwd }));
  const { config, configPath } = loadConfig(configSource);

  // Relative paths belong to the config's directory, not to wherever the process
  // was started. This one default is what stops `./assets/screenshots` from
  // resolving inside an installed plugin's own tree.
  const projectRoot = options.projectRoot ?? (configPath ? dirname(configPath) : cwd);

  const log = createLog({ onEvent: options.onEvent ?? null });
  const dryRun = options.dryRun ?? false;

  const tokenProvider = credentials
    ? createTokenProvider(credentials)
    : () => {
        throw new Error("App Store Connect credentials are not configured");
      };

  const client = new AscClient({
    tokenProvider,
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    dryRun,
    log,
    random,
  });

  const appId = credentials?.appId ?? "";

  return {
    credentials: /** @type {any} */ (credentials),
    appId,
    projectRoot,
    configPath,
    config,
    client,
    discovery: new Discovery(client, appId),
    uploader: new AssetUploader(client),
    dryRun,
    log,
    findings,
    resolvePath: (rel, purpose) => resolveProjectPath(projectRoot, rel, { purpose }),
  };
}

/** True when the context has everything an App Store Connect call needs. */
export const isUsable = (ctx) => Boolean(ctx.credentials && ctx.appId);
