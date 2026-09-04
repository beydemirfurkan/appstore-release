// Composition root. Single responsibility: wire the dependencies once and hand every
// command the same context (dependency injection — commands never construct their own deps).
import { readEnvironment } from "./env.mjs";
import { createTokenProvider } from "../asc/jwt.mjs";
import { AscClient } from "../asc/client.mjs";
import { Discovery } from "../asc/discovery.mjs";
import { AssetUploader } from "../asc/assets.mjs";
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
 * @property {CliOptions} [options]  attached by the dispatcher, not by createContext
 */

/**
 * @typedef {Object} CliOptions
 * @property {boolean} [submit]  finalize the review submission
 * @property {boolean} [json]    emit the machine-readable summary
 * @property {string}  [build]   attach a specific build instead of the newest VALID one
 */

/**
 * What every operation actually receives. `discovery` is null only when no app id
 * was supplied, and the dispatcher always requires one before running an operation.
 * @typedef {Context & { discovery: Discovery }} OperationContext
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
