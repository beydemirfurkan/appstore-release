// Environment parsing & validation. Single responsibility: turn process.env into a
// validated Environment object, failing fast with an actionable message.
import { readFileSync } from "node:fs";

export class EnvironmentError extends Error {}

/**
 * @typedef {Object} Environment
 * @property {string} keyId
 * @property {string} issuerId
 * @property {string} privateKey   PEM contents of the .p8
 * @property {string} [appId]
 * @property {string} [configPath]
 */

/**
 * @param {{ requireAppId?: boolean, requireConfig?: boolean }} [opts]
 * @returns {Environment}
 */
export function readEnvironment({ requireAppId = true, requireConfig = false } = {}) {
  const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_P8_PATH, ASC_APP_ID, APPSTORE_CONFIG } = process.env;

  // One combined guard rather than a `missing.length` check afterwards, so the
  // three required values are narrowed to `string` for the rest of the function.
  if (
    !ASC_KEY_ID ||
    !ASC_ISSUER_ID ||
    !ASC_P8_PATH ||
    (requireAppId && !ASC_APP_ID) ||
    (requireConfig && !APPSTORE_CONFIG)
  ) {
    const missing = [];
    if (!ASC_KEY_ID) missing.push("ASC_KEY_ID");
    if (!ASC_ISSUER_ID) missing.push("ASC_ISSUER_ID");
    if (!ASC_P8_PATH) missing.push("ASC_P8_PATH");
    if (requireAppId && !ASC_APP_ID) missing.push("ASC_APP_ID");
    if (requireConfig && !APPSTORE_CONFIG) missing.push("APPSTORE_CONFIG");
    throw new EnvironmentError(`Missing required environment variables: ${missing.join(", ")}`);
  }

  let privateKey;
  try {
    privateKey = readFileSync(ASC_P8_PATH, "utf8");
  } catch {
    throw new EnvironmentError(`Cannot read ASC_P8_PATH: ${ASC_P8_PATH}`);
  }

  return {
    keyId: ASC_KEY_ID,
    issuerId: ASC_ISSUER_ID,
    privateKey,
    appId: ASC_APP_ID,
    configPath: APPSTORE_CONFIG,
  };
}
