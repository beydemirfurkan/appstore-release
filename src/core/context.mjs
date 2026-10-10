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
import { repositoryBoundary, resolveProjectPath } from "./paths.mjs";
import { stateDir } from "./state.mjs";
import { createTokenProvider } from "../asc/jwt.mjs";
import { AscClient, DEFAULT_BASE_URL } from "../asc/client.mjs";
import { readExpoProject } from "./eas.mjs";
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
 * @property {string} stateDir     where what App Store Connect does not remember is kept (core/state.mjs)
 * @property {Record<string, string|undefined>} env   the environment the context was made with (runtime.env), never process.env behind its back
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

  const configSource =
    typeof options.config === "object" && options.config !== null
      ? options.config
      : (options.config ?? findConfigPath({ env, cwd }));
  const { config: loaded, configPath } = loadConfig(configSource);

  // Relative paths belong to the config's directory, not to wherever the process
  // was started. This one default is what stops `./assets/screenshots` from
  // resolving inside an installed plugin's own tree.
  const projectRoot = options.projectRoot ?? (configPath ? dirname(configPath) : cwd);
  // Paths may reach anywhere in the repository the project is in, not only its
  // own folder: a monorepo keeps its screenshots beside the app.
  const boundary = repositoryBoundary(projectRoot);

  // An Expo project already knows its bundle id and App Store Connect app id;
  // they fill in what the config and the environment leave out.
  const expo = readExpoProject(projectRoot);
  const config =
    loaded && expo.bundleId && !(/** @type {any} */ (loaded).bundleId)
      ? { ...loaded, bundleId: expo.bundleId }
      : loaded;
  const { credentials, findings } = resolveCredentials(options.credentials ?? {}, {
    env: expo.ascAppId && !env.ASC_APP_ID ? { ...env, ASC_APP_ID: expo.ascAppId } : env,
  });

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
    baseUrl: options.baseUrl ?? loopbackOverride(env.APPSTORE_RELEASE_API_BASE) ?? DEFAULT_BASE_URL,
    dryRun,
    log,
    random,
  });

  const appId = credentials?.appId ?? "";

  return {
    credentials: /** @type {any} */ (credentials),
    appId,
    projectRoot,
    stateDir: stateDir(env),
    env,
    configPath,
    config,
    client,
    discovery: new Discovery(client, appId),
    uploader: new AssetUploader(client),
    dryRun,
    log,
    findings,
    resolvePath: (rel, purpose) => resolveProjectPath(projectRoot, rel, { purpose, boundary }),
  };
}

/**
 * APPSTORE_RELEASE_API_BASE points the client at a local fake App Store Connect —
 * the demo recordings and end-to-end tests use it. It is honoured for loopback
 * addresses only: a signed token must never be sent anywhere else because an
 * environment variable said so.
 *
 * @param {string|undefined} value
 */
function loopbackOverride(value) {
  if (!value) return undefined;
  try {
    const { protocol, hostname } = new URL(value);
    if (protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(hostname)) return value.replace(/\/$/, "");
  } catch {
    // fall through
  }
  throw new Error(`APPSTORE_RELEASE_API_BASE must be a loopback http:// URL, got ${value}`);
}

/** True when the context has everything an App Store Connect call needs. */
export const isUsable = (ctx) => Boolean(ctx.credentials && ctx.appId);
