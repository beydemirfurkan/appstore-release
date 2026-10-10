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
  // Products are checked per product by their operations (core/products.mjs):
  // an app that sells nothing must not fail the pipeline for want of a price.
  subscription: [],
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
    // `screenshots.sets` gives each set its own `dir`, so the top-level one is
    // only required when there are no sets.
    .filter(
      (path) =>
        !(
          path === "screenshots.dir" &&
          ((Array.isArray(config.screenshots?.sets) && config.screenshots.sets.length) || config.screenshots?.from)
        ),
    )
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

/**
 * Per-listing limits, applied to every locale. Keywords are measured in UTF-8
 * bytes: Apple's own wording is "up to 100 bytes", so a Turkish or Japanese list
 * well under 100 characters can still be refused.
 *
 * @type {Array<{ field: string, max: number, unit: "characters"|"bytes" }>}
 */
const LIMITS = [
  { field: "subtitle", max: 30, unit: "characters" },
  { field: "keywords", max: 100, unit: "bytes" },
  { field: "promotionalText", max: 170, unit: "characters" },
  { field: "name", max: 30, unit: "characters" },
];

/** @param {string} value @param {"characters"|"bytes"} unit */
const measure = (value, unit) => (unit === "bytes" ? Buffer.byteLength(value, "utf8") : [...value].length);

/** Guideline 2.3.10: no other platform's name in the metadata. */
const OTHER_PLATFORM_RE = /\b(android|google play|play store)\b/i;

/** Too common to count as the subtitle repeating the name. */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "you",
  "app",
  "our",
  "von",
  "und",
  "für",
  "ile",
  "için",
  "les",
  "des",
  "pour",
  "con",
  "para",
  "por",
]);

/**
 * Text App Review rejects as unfinished (Guideline 2.1). "Todo" alone is left
 * out on purpose: it is a perfectly good word in a to-do app's listing.
 */
const PLACEHOLDER_RE = /lorem ipsum|\bTBD\b|\bFIXME\b|\bTODO:|\bXXX\b|\[insert|\bplaceholder\b|coming soon/i;
const TEXT_FIELDS = ["name", "subtitle", "description", "keywords", "promotionalText", "whatsNew"];

/** Lowercased words of three letters or more that are not filler. @param {unknown} text */
const termsOf = (text) =>
  typeof text === "string"
    ? [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter((w) => [...w].length > 2 && !STOPWORDS.has(w))
    : [];

/**
 * Advice rather than rules: none of these is an API error, so they are
 * warnings — but each one is either a likely rejection or wasted search reach.
 *
 * @param {Record<string, any>} metadata
 * @param {(field: string) => string} keyFor
 */
function listingLints(metadata, keyFor) {
  const out = [];
  for (const field of TEXT_FIELDS) {
    const value = metadata[field];
    const hit = typeof value === "string" ? PLACEHOLDER_RE.exec(value) : null;
    if (!hit) continue;
    const path = keyFor(field);
    out.push(
      finding({
        id: `config.${path}.placeholder`,
        severity: Severity.WARNING,
        category: Category.CONFIG,
        title: `config.${path} looks unfinished ("${hit[0]}")`,
        detail: "App Review rejects listings with placeholder text under Guideline 2.1 (App Completeness).",
        fixOwner: FixOwner.CLI,
        fix: `Replace the placeholder in config.${path}.`,
        docs: "references/metadata.md",
      }),
    );
  }

  for (const field of TEXT_FIELDS) {
    const value = metadata[field];
    const hit = typeof value === "string" ? OTHER_PLATFORM_RE.exec(value) : null;
    if (!hit) continue;
    const path = keyFor(field);
    out.push(
      finding({
        id: `config.${path}.other-platform`,
        severity: Severity.WARNING,
        category: Category.CONFIG,
        title: `config.${path} mentions "${hit[0]}"`,
        detail:
          "Guideline 2.3.10: metadata must not name other mobile platforms or their stores. App Review rejects it.",
        fixOwner: FixOwner.CLI,
        fix: `Remove "${hit[0]}" from config.${path}; say "on your phone" or name only Apple platforms.`,
        guideline: "2.3.10",
        docs: "references/metadata.md",
      }),
    );
  }

  const nameWords = termsOf(metadata.name);
  const repeated = termsOf(metadata.subtitle).filter((w) => nameWords.includes(w));
  if (repeated.length) {
    const path = keyFor("subtitle");
    out.push(
      finding({
        id: `config.${path}.repeats-name`,
        severity: Severity.WARNING,
        category: Category.CONFIG,
        title: `config.${path} repeats the name (${repeated.join(", ")})`,
        detail:
          "The name and subtitle are both searched; a word in both is indexed once. The subtitle's 30 characters " +
          "reach further saying what the app does in new words.",
        fixOwner: FixOwner.CLI,
        fix: "Rewrite the subtitle without the name's words: the benefit, in the words people search for.",
        docs: "references/metadata.md",
      }),
    );
  }

  if (typeof metadata.keywords !== "string") return out;
  const path = keyFor("keywords");
  const short = metadata.keywords
    .split(",")
    .map((w) => w.trim())
    // Latin-script terms only: two CJK characters are a whole word.
    .filter((w) => w && /^[\p{Script=Latin}\p{N}]{1,2}$/u.test(w));
  if (short.length) {
    out.push(
      finding({
        id: `config.${path}.short`,
        severity: Severity.WARNING,
        category: Category.CONFIG,
        title: `config.${path} has keywords of two characters or fewer (${short.join(", ")})`,
        detail: 'Apple asks for keywords "each greater than two characters"; shorter ones rarely match a search.',
        fixOwner: FixOwner.CLI,
        fix: "Replace them with full words, or fold them into a longer term.",
        docs: "references/metadata.md",
      }),
    );
  }
  const words = metadata.keywords
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set();
  const duplicates = [...new Set(words.filter((w) => seen.has(w) || !seen.add(w)))];
  // Apple already indexes the name and subtitle; repeating their words in the
  // keyword field spends the 100 bytes on nothing.
  const indexed = new Set(`${metadata.name ?? ""} ${metadata.subtitle ?? ""}`.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  const redundant = words.filter((w) => !w.includes(" ") && indexed.has(w));
  const spaces = (metadata.keywords.match(/,\s+/g) ?? []).reduce((n, m) => n + m.length - 1, 0);

  const waste = [];
  if (duplicates.length) waste.push(`repeated: ${duplicates.join(", ")}`);
  if (redundant.length) waste.push(`already in the name or subtitle: ${redundant.join(", ")}`);
  if (spaces) waste.push(`${spaces} space${spaces === 1 ? "" : "s"} after commas`);
  if (waste.length) {
    out.push(
      finding({
        id: `config.${path}.wasted`,
        severity: Severity.WARNING,
        category: Category.CONFIG,
        title: `config.${path} spends characters on nothing`,
        detail: `${waste.join("; ")}. The keyword field is 100 bytes; every one should be a new search term.`,
        fixOwner: FixOwner.CLI,
        fix: "Drop repeats and words from the name or subtitle, and separate with commas only.",
        docs: "references/metadata.md",
      }),
    );
  }
  return out;
}

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

    for (const { field, max, unit } of LIMITS) {
      const value = metadata[field];
      if (typeof value !== "string") continue;
      const size = measure(value, unit);
      if (size <= max) continue;
      const path = keyFor(field);
      const chars = [...value].length;
      out.push(
        finding({
          id: `config.${path}.too-long`,
          category: Category.CONFIG,
          title: `config.${path} exceeds ${max} ${unit}`,
          detail:
            unit === "bytes" && chars <= max
              ? `It is ${size} bytes in UTF-8 (${chars} characters). Apple counts bytes: letters such as ç, ş, ü take two, ` +
                `Japanese and Chinese three. App Store Connect rejects the update with a 409.`
              : `It is ${size} ${unit}. App Store Connect rejects the update with a 409.`,
          fixOwner: FixOwner.CLI,
          fix: `Shorten config.${path} to ${max} ${unit} or fewer.`,
          evidence: { expected: max, actual: size },
          docs: "references/gotchas.md#metadata",
        }),
      );
    }

    out.push(...listingLints(metadata, keyFor));

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
