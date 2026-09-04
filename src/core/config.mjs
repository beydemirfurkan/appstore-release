// Config loading & validation. Single responsibility: produce a validated config
// object, or a precise list of what the user must fill in. No network, no side effects.
import { readFileSync } from "node:fs";

export class ConfigError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.missing = missing;
  }
}

const EMOJI_RE = /[\p{Extended_Pictographic}]/u;

/** Load and parse config.json. */
export function loadConfig(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`Cannot read config at ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`Config is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Validate the config for a given set of concerns. Returns { valid, missing, warnings }.
 * Does not throw — callers decide whether missing fields are fatal for their command.
 *
 * @param {object} config
 * @param {{ needs?: ("metadata"|"pricing"|"review"|"screenshots"|"subscription"|"category")[] }} [opts]
 */
export function validateConfig(config, { needs = [] } = {}) {
  const missing = [];
  const warnings = [];
  const need = (path, cond) => {
    if (!cond) missing.push(path);
  };

  if (!config || typeof config !== "object") {
    return { valid: false, missing: ["<entire config>"], warnings };
  }
  need("locale", config.locale);

  if (needs.includes("metadata")) {
    const m = config.metadata || {};
    need("metadata.name", m.name);
    need("metadata.description", m.description);
    need("metadata.keywords", m.keywords);
    need("metadata.supportUrl", m.supportUrl);
    need("metadata.privacyPolicyUrl", m.privacyPolicyUrl);
    if (m.subtitle && m.subtitle.length > 30) warnings.push("metadata.subtitle exceeds 30 chars");
    if (m.keywords && m.keywords.length > 100) warnings.push("metadata.keywords exceeds 100 chars");
    if (m.description && EMOJI_RE.test(m.description))
      warnings.push("metadata.description contains emoji — ASC will reject it");
    if (m.promotionalText && m.promotionalText.length > 170)
      warnings.push("metadata.promotionalText exceeds 170 chars");
  }
  if (needs.includes("pricing")) need("metadata.copyright", config.metadata?.copyright);
  if (needs.includes("category")) need("category.primary", config.category?.primary);
  if (needs.includes("review")) {
    const r = config.review || {};
    need("review.contactFirstName", r.contactFirstName);
    need("review.contactLastName", r.contactLastName);
    need("review.contactPhone", r.contactPhone);
    need("review.contactEmail", r.contactEmail);
  }
  if (needs.includes("screenshots")) need("screenshots.dir", config.screenshots?.dir);
  if (needs.includes("subscription")) {
    const s = config.subscription || {};
    need("subscription.productId", s.productId);
    need("subscription.priceTerritory", s.priceTerritory);
    need("subscription.priceAmount", s.priceAmount != null);
    need("subscription.reviewScreenshot", s.reviewScreenshot);
  }

  return { valid: missing.length === 0, missing, warnings };
}
