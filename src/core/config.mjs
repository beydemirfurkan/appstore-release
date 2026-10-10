// Config loading. Single responsibility: produce a parsed config plus the path it
// came from, or a precise reason why not. No network, no side effects.
//
// Validation lives in requirements.mjs; this module only gets the object.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { fromStoreConfig, isStoreConfig, mergeConfig } from "./eas.mjs";

export class ConfigError extends Error {}

/**
 * Searched in order when no path is given. `appstore.config.json` is first and
 * is what `init` writes: the old bare `config.json` collides with this repo's own
 * .gitignore rule, so anyone following our secret-hygiene advice ended up
 * ignoring their own config.
 */
export const CONFIG_CANDIDATES = Object.freeze([
  "appstore.config.json",
  ".appstore-release/config.json",
  "config.json", // still discovered, for configs written against v1
  "store.config.json", // an Expo project's EAS Metadata, used as is when nothing else exists
]);

/**
 * @param {{ explicit?: string, env?: Record<string, string|undefined>, cwd?: string }} [opts]
 * @returns {string|null} absolute path, or null when there is nothing to load
 */
export function findConfigPath({ explicit, env = process.env, cwd = process.cwd() } = {}) {
  const named = explicit ?? env.APPSTORE_CONFIG;
  if (named) return isAbsolute(named) ? named : resolve(cwd, named);
  for (const candidate of CONFIG_CANDIDATES) {
    const p = resolve(cwd, candidate);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Accept an already-parsed object as readily as a path — a library or MCP caller
 * may hold the config in memory and should not have to write it to disk first.
 *
 * @param {string|object|null|undefined} source
 * @returns {{ config: object|null, configPath: string|null }}
 */
export function loadConfig(source) {
  if (source == null) return { config: null, configPath: null };
  if (typeof source === "object") return { config: source, configPath: null };

  let raw;
  try {
    raw = readFileSync(source, "utf8");
  } catch {
    throw new ConfigError(`Cannot read config at ${source}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`Config is not valid JSON (${source}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const configPath = resolve(source);

  // An EAS Metadata file on its own: translate it.
  if (isStoreConfig(parsed)) return { config: fromStoreConfig(parsed), configPath };

  // Ours, layered over an EAS Metadata file it names. Ours wins on overlap.
  if (typeof parsed.easMetadata === "string") {
    const easPath = resolve(dirname(configPath), parsed.easMetadata);
    const { config: eas } = loadConfig(easPath);
    const { easMetadata, ...own } = parsed;
    return { config: { ...mergeConfig(eas ?? {}, own), easMetadata }, configPath };
  }
  return { config: parsed, configPath };
}
