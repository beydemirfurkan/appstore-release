// Composition root. Single responsibility: wire the dependencies once and hand every
// command the same context (dependency injection — commands never construct their own deps).
import { readEnvironment } from "./env.mjs";
import { createTokenProvider } from "./jwt.mjs";
import { AscClient } from "./client.mjs";
import { Discovery } from "./discovery.mjs";
import { AssetUploader } from "./assets.mjs";
import { loadConfig } from "./config.mjs";
import { createLogger } from "./log.mjs";

/**
 * @typedef {Object} Context
 * @property {import("./env.mjs").Environment} env
 * @property {AscClient} client
 * @property {Discovery|null} discovery
 * @property {AssetUploader} uploader
 * @property {object|null} config
 * @property {ReturnType<typeof createLogger>} log
 */

/** @returns {Context} */
export function createContext({ requireAppId = true, requireConfig = false } = {}) {
  const env = readEnvironment({ requireAppId, requireConfig });
  const client = new AscClient({ tokenProvider: createTokenProvider(env) });
  return {
    env,
    client,
    discovery: env.appId ? new Discovery(client, env.appId) : null,
    uploader: new AssetUploader(client),
    config: env.configPath ? loadConfig(env.configPath) : null,
    log: createLogger(),
  };
}
