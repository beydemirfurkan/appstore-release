// Turn "whatever the caller gave us" into a validated set of App Store Connect
// credentials. Explicit input wins over the environment, so one process can serve
// several apps — which is what the MCP server and any library consumer need, and
// what reading process.env directly made impossible.

import { readFileSync } from "node:fs";
import { finding, Severity, Category, FixOwner } from "./findings.mjs";

export class CredentialsError extends Error {}

/**
 * @typedef {Object} AscCredentialsInput
 * @property {string} [keyId]
 * @property {string} [issuerId]
 * @property {string} [privateKey]      PEM text, or base64 of the .p8
 * @property {string} [privateKeyPath]  path to AuthKey_XXXXXXXXXX.p8
 * @property {string} [appId]
 */

/**
 * @typedef {Object} AscCredentials
 * @property {string} keyId
 * @property {string} issuerId
 * @property {string} privateKey  PEM text
 * @property {string} [appId]
 */

const PEM_MARKER = "-----BEGIN";
const KEY_ID_RE = /^[A-Z0-9]{10}$/;
const NUMERIC_RE = /^\d+$/;

/**
 * Accept the .p8 as PEM text or as its base64 encoding, so credentials can be
 * carried in an environment variable where writing a file is not an option (CI,
 * containers, an MCP host's env block).
 *
 * @param {string} value
 * @returns {string} PEM text
 */
function toPem(value) {
  const trimmed = value.trim();
  if (trimmed.includes(PEM_MARKER)) return trimmed;
  let decoded;
  try {
    decoded = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    throw new CredentialsError("private key is neither PEM text nor valid base64");
  }
  if (!decoded.includes(PEM_MARKER)) {
    throw new CredentialsError("private key is neither PEM text nor base64-encoded PEM");
  }
  return decoded.trim();
}

/**
 * Resolve credentials from explicit input, falling back to the environment.
 * Never throws for *missing* values — it reports them as findings so the caller
 * decides whether that is fatal. It does throw for values that are present but
 * unusable (an unreadable key file), because there is nothing to report about.
 *
 * @param {AscCredentialsInput} [input]
 * @param {{ env?: Record<string, string|undefined> }} [runtime]
 * @returns {{ credentials: AscCredentials|null, findings: import("./findings.mjs").Finding[] }}
 */
export function resolveCredentials(input = {}, { env = process.env } = {}) {
  const keyId = input.keyId ?? env.ASC_KEY_ID;
  const issuerId = input.issuerId ?? env.ASC_ISSUER_ID;
  const appId = input.appId ?? env.ASC_APP_ID;
  const inlineKey = input.privateKey ?? env.ASC_P8;
  const keyPath = input.privateKeyPath ?? env.ASC_P8_PATH;

  const findings = [];
  const missing = (name, envVar, hint) =>
    findings.push(
      finding({
        id: `account.credentials.${name}`,
        severity: Severity.BLOCKER,
        category: Category.ACCOUNT,
        title: `No ${envVar}`,
        detail: `${envVar} is not set and no ${name} was passed in.`,
        fixOwner: FixOwner.EXTERNAL,
        fix: hint,
        docs: "references/setup.md",
      }),
    );

  if (!keyId) missing("keyId", "ASC_KEY_ID", "The 10-character Key ID shown next to the key in App Store Connect.");
  if (!issuerId) missing("issuerId", "ASC_ISSUER_ID", "The Issuer ID shown above the key list in App Store Connect.");
  if (!inlineKey && !keyPath) {
    missing(
      "privateKey",
      "ASC_P8_PATH",
      "Point ASC_P8_PATH at the downloaded AuthKey_XXXXXXXXXX.p8, or put its contents in ASC_P8.",
    );
  }

  // Shape checks on values we did get — a bundle id in ASC_APP_ID is a common
  // mistake that otherwise surfaces as a baffling 404 several calls later.
  if (keyId && !KEY_ID_RE.test(keyId)) {
    findings.push(
      finding({
        id: "account.credentials.keyId.malformed",
        severity: Severity.WARNING,
        category: Category.ACCOUNT,
        title: "ASC_KEY_ID does not look like a key id",
        detail: `Expected 10 uppercase alphanumerics, got "${keyId}".`,
        fixOwner: FixOwner.EXTERNAL,
        fix: "Copy the Key ID column from App Store Connect → Users and Access → Integrations.",
      }),
    );
  }
  if (appId && !NUMERIC_RE.test(appId)) {
    findings.push(
      finding({
        id: "account.credentials.appId.malformed",
        severity: Severity.BLOCKER,
        category: Category.ACCOUNT,
        title: "ASC_APP_ID is not the numeric app id",
        detail: `Got "${appId}". This is the number in the App Store Connect URL, not the bundle id.`,
        fixOwner: FixOwner.EXTERNAL,
        fix: "Open the app in App Store Connect; the id is the digits in /apps/<id>/.",
      }),
    );
  }

  if (!keyId || !issuerId || (!inlineKey && !keyPath)) return { credentials: null, findings };

  let privateKey;
  if (inlineKey) {
    privateKey = toPem(inlineKey);
  } else {
    let raw;
    try {
      raw = readFileSync(/** @type {string} */ (keyPath), "utf8");
    } catch {
      throw new CredentialsError(`Cannot read the private key at ${keyPath}`);
    }
    privateKey = toPem(raw);
  }

  const credentials = { keyId, issuerId, appId, privateKey };
  // Keep the key out of console.log, JSON.stringify, --json output and MCP results.
  Object.defineProperty(credentials, "privateKey", { value: privateKey, enumerable: false, writable: false });
  return { credentials, findings };
}
