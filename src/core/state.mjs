// What App Store Connect does not remember for us. Today that is one thing: a
// first subscription or in-app purchase it refused by API. Apple keeps no record
// of the attempt, so without this the readiness report would say "ready" again
// and an agent following it would retry the same refusal forever.
//
// One small JSON file per app, outside the project (nothing to commit or
// ignore): $APPSTORE_RELEASE_STATE_DIR, else $XDG_CACHE_HOME/appstore-release/state,
// else ~/.cache/appstore-release/state. Losing it costs one more refused attempt,
// nothing else — it is a memory, never a source of truth.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * @typedef {Object} Refusal
 * @property {string} productId
 * @property {string} versionId   the app version it was refused with; another version is a fresh try
 * @property {string} at          ISO time
 * @property {string[]} reasons   App Store Connect's own sentences
 */

/** @param {Record<string, string|undefined>} env */
export function stateDir(env = process.env) {
  if (env.APPSTORE_RELEASE_STATE_DIR) return env.APPSTORE_RELEASE_STATE_DIR;
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "appstore-release", "state");
}

/** @param {string} dir @param {string} appId */
const fileFor = (dir, appId) => join(dir, `${String(appId).replace(/[^0-9A-Za-z_-]/g, "_")}.json`);

/**
 * @param {string} dir
 * @param {string} appId
 * @returns {{ refusals: Refusal[] }}
 */
export function readState(dir, appId) {
  try {
    const data = JSON.parse(readFileSync(fileFor(dir, appId), "utf8"));
    return { refusals: Array.isArray(data?.refusals) ? data.refusals : [] };
  } catch {
    return { refusals: [] };
  }
}

/**
 * Forget the refusals of products that have just been changed: App Store
 * Connect may take a fixed product, so the next submit tries the API again.
 *
 * @param {string} dir
 * @param {string} appId
 * @param {string[]} productIds
 */
export function forgetRefusals(dir, appId, productIds) {
  const state = readState(dir, appId);
  const keep = state.refusals.filter((r) => !productIds.includes(r.productId));
  if (keep.length === state.refusals.length) return false;
  try {
    const file = fileFor(dir, appId);
    writeFileSync(`${file}.tmp`, JSON.stringify({ refusals: keep }, null, 2));
    renameSync(`${file}.tmp`, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Record refusals, replacing any earlier one for the same product and version.
 * Best effort: a read-only home directory must not turn a refusal into a crash.
 *
 * @param {string} dir
 * @param {string} appId
 * @param {Refusal[]} refusals
 */
export function recordRefusals(dir, appId, refusals) {
  try {
    const state = readState(dir, appId);
    const key = (/** @type {Refusal} */ r) => `${r.productId}@${r.versionId}`;
    const fresh = new Set(refusals.map(key));
    const next = { refusals: [...state.refusals.filter((r) => !fresh.has(key(r))), ...refusals] };
    mkdirSync(dir, { recursive: true });
    const file = fileFor(dir, appId);
    writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
    renameSync(`${file}.tmp`, file);
    return true;
  } catch {
    return false;
  }
}
