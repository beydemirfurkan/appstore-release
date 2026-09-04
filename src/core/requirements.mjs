// What each operation needs from the config, declared once instead of re-checked
// ad hoc inside every operation. `meta.needs` used to be documented but inert —
// nothing read it — so a missing field surfaced as a cryptic 409 from Apple
// instead of "you did not fill in metadata.keywords".

import { createRequire } from "node:module";

import { finding, Severity, Category, FixOwner } from "./findings.mjs";
import { validateAgainstSchema } from "./schema.mjs";
import { resolveLocales } from "./locales.mjs";

/** The published schema, also served by `appstore-release schema`. */
export const CONFIG_SCHEMA = createRequire(import.meta.url)("../../schemas/config.schema.json");

/** Config concerns → the key paths that must be present. */
export const REQUIREMENTS = Object.freeze({
  // metadata is handled separately: it is required once per configured locale.
  metadata: [],
  pricing: ["metadata.copyright"],
  category: ["category.primary"],
  review: ["review.contactFirstName", "review.contactLastName", "review.contactPhone", "review.contactEmail"],
  screenshots: ["screenshots.dir"],
  subscription: [
    "subscription.productId",
    "subscription.priceTerritory",
    "subscription.priceAmount",
    "subscription.reviewScreenshot",
  ],
  credentials: ["bundleId"],
});

/** @typedef {keyof typeof REQUIREMENTS} Concern */

/** Fields every configured locale must carry. */
export const LOCALE_REQUIRED = Object.freeze(["name", "description", "keywords", "supportUrl", "privacyPolicyUrl"]);

/** @param {object|null} config @param {string} path */
const at = (config, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), config);

/** Every key path required by a set of concerns, plus the always-required ones. */
export function requirementsFor(needs = []) {
  const paths = ["locale"];
  for (const need of needs) paths.push(...(REQUIREMENTS[need] ?? []));
  return [...new Set(paths)];
}

/**
 * Findings for everything an operation needs and does not have.
 *
 * @param {object|null} config
 * @param {string[]} needs
 * @returns {import("./findings.mjs").Finding[]}
 */
export function checkRequirements(config, needs = []) {
  if (!config) {
    return [
      finding({
        id: "config.missing",
        category: Category.CONFIG,
        title: "No config file",
        detail: "This operation is config-driven and no config was found.",
        fixOwner: FixOwner.CLI,
        fix: "Create one with `appstore-release init`, or point --config at an existing file.",
      }),
    ];
  }
  const findings = requirementsFor(needs)
    .filter((path) => at(config, path) == null || at(config, path) === "")
    .map((path) =>
      finding({
        id: `config.${path}.missing`,
        category: Category.CONFIG,
        title: `config.${path} is required`,
        detail: `The operation cannot run without config.${path}.`,
        fixOwner: FixOwner.CLI,
        fix: `Add "${path}" to your config. See \`appstore-release schema\` for its shape.`,
        evidence: { resource: "config", expected: path },
      }),
    );

  if (needs.includes("metadata")) findings.push(...checkLocaleRequirements(config));
  return findings;
}

/**
 * Every configured locale needs a complete listing. Reporting only the primary
 * one would let the others ship empty, which is exactly the failure this
 * replaces.
 *
 * @param {object} config
 * @returns {import("./findings.mjs").Finding[]}
 */
function checkLocaleRequirements(config) {
  const locales = resolveLocales(config);
  if (!locales.length) return [];

  const single = locales.length === 1;
  const out = [];
  for (const { locale, metadata } of locales) {
    for (const field of LOCALE_REQUIRED) {
      if (metadata[field] != null && metadata[field] !== "") continue;
      // Name the key the user would actually edit: the flat one when there is
      // only a single locale, the nested one otherwise.
      const path = single ? `metadata.${field}` : `locales.${locale}.${field}`;
      out.push(
        finding({
          id: `config.${path}.missing`,
          category: Category.CONFIG,
          title: `config.${path} is required`,
          detail: single
            ? `The listing cannot be written without ${field}.`
            : `The ${locale} listing has no ${field}, and Apple rejects a half-filled localization.`,
          fixOwner: FixOwner.CLI,
          fix: `Add "${path}" to your config, or set metadata.${field} to share one value across locales.`,
          evidence: { resource: "config", expected: path, actual: locale },
        }),
      );
    }
  }
  return out;
}

// ── Semantic rules Apple enforces but does not document in its schema ──────────
// These were warnings, which was a lie: emoji in the description is a hard 409,
// not a style note. A blocker that stops us before the API call is strictly
// better than a 409 halfway through a pipeline.

const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** Per-listing limits, applied to every locale. */
const LIMITS = [
  { field: "subtitle", max: 30 },
  { field: "keywords", max: 100 },
  { field: "promotionalText", max: 170 },
  { field: "name", max: 30 },
];

/**
 * @param {object|null} config
 * @returns {import("./findings.mjs").Finding[]}
 */
export function checkSemantics(config) {
  if (!config) return [];
  const locales = resolveLocales(config);
  if (!locales.length) return [];

  const single = locales.length === 1;
  const out = [];

  for (const { locale, metadata } of locales) {
    // Name the key the author would edit, and only qualify by locale when there
    // is more than one to distinguish.
    const keyFor = (field) => (single ? `metadata.${field}` : `locales.${locale}.${field}`);

    for (const { field, max } of LIMITS) {
      const value = metadata[field];
      if (typeof value !== "string" || value.length <= max) continue;
      const path = keyFor(field);
      out.push(
        finding({
          id: `config.${path}.too-long`,
          category: Category.CONFIG,
          title: `config.${path} exceeds ${max} characters`,
          detail: `It is ${value.length} characters. App Store Connect rejects the update with a 409.`,
          fixOwner: FixOwner.CLI,
          fix: `Shorten config.${path} to ${max} characters or fewer.`,
          evidence: { expected: max, actual: value.length },
          docs: "references/gotchas.md#metadata",
        }),
      );
    }

    const description = metadata.description;
    if (typeof description === "string" && EMOJI_RE.test(description)) {
      const path = keyFor("description");
      out.push(
        finding({
          id: `config.${path}.emoji`,
          category: Category.CONFIG,
          title: `config.${path} contains emoji`,
          detail:
            "App Store Connect rejects this with 409 ATTRIBUTE.INVALID.INVALID_CHARACTERS. " +
            "Bullets (•) and em dashes (—) are fine; pictographs are not.",
          fixOwner: FixOwner.CLI,
          fix: "Remove the emoji; use plain uppercase section headers instead.",
          docs: "references/gotchas.md#metadata",
        }),
      );
    }
  }

  return out;
}

/**
 * Everything wrong with a config, for a given set of concerns.
 *
 * Three layers, cheapest first: the schema catches shape and typos, the
 * requirements catch what this particular operation needs, and the semantic
 * rules catch what Apple enforces but no schema can express.
 *
 * @param {object|null} config
 * @param {{ needs?: string[], schema?: boolean }} [opts]
 * @returns {{ valid: boolean, findings: import("./findings.mjs").Finding[] }}
 */
export function validateConfig(config, { needs = [], schema = true } = {}) {
  const findings = [
    ...(schema && config ? validateAgainstSchema(config, CONFIG_SCHEMA) : []),
    ...checkRequirements(config, needs),
    ...checkSemantics(config),
  ];
  // One key can trip several layers; report each problem once.
  const seen = new Set();
  const unique = findings.filter((f) => !seen.has(f.id) && seen.add(f.id));
  return { valid: !unique.some((f) => f.severity === Severity.BLOCKER), findings: unique };
}
