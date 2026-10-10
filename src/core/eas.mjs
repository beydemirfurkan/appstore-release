// Expo projects, read as they are. An EAS Metadata `store.config.json` already
// describes most of a listing; `app.json` and `eas.json` already know the bundle
// id and the App Store Connect app id. Making an Expo user retype any of that
// into a second file would be the opposite of the point.
//
// What EAS Metadata does not cover — screenshots, price, subscriptions, content
// rights, submission — comes from appstore.config.json as usual, and where both
// files set the same thing, appstore.config.json wins.
//
// Only JSON is read. `store.config.js` would mean executing the project's code
// to learn its listing, which is not something a release tool should do quietly.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** EAS's App Review keys → ours. */
const REVIEW_KEYS = {
  firstName: "contactFirstName",
  lastName: "contactLastName",
  email: "contactEmail",
  phone: "contactPhone",
  demoUsername: "demoAccountName",
  demoPassword: "demoAccountPassword",
  demoRequired: "demoAccountRequired",
  notes: "notes",
};

/** EAS's per-locale info keys → our metadata keys. */
const INFO_KEYS = {
  title: "name",
  subtitle: "subtitle",
  description: "description",
  releaseNotes: "whatsNew",
  promoText: "promotionalText",
  marketingUrl: "marketingUrl",
  supportUrl: "supportUrl",
  privacyPolicyUrl: "privacyPolicyUrl",
};

/** Age-rating keys EAS shares with us verbatim (values included). */
const ADVISORY_KEYS = [
  "alcoholTobaccoOrDrugUseOrReferences",
  "contests",
  "gamblingSimulated",
  "gunsOrOtherWeapons",
  "horrorOrFearThemes",
  "matureOrSuggestiveThemes",
  "medicalOrTreatmentInformation",
  "profanityOrCrudeHumor",
  "sexualContentGraphicAndNudity",
  "sexualContentOrNudity",
  "violenceCartoonOrFantasy",
  "violenceRealistic",
  "violenceRealisticProlongedGraphicOrSadistic",
  "advertising",
  "ageAssurance",
  "gambling",
  "healthOrWellnessTopics",
  "lootBox",
  "messagingAndChat",
  "parentalControls",
  "unrestrictedWebAccess",
  "userGeneratedContent",
  "kidsAgeBand",
];

/** True for the shape of an EAS Metadata file. @param {any} value */
export const isStoreConfig = (value) =>
  Boolean(value && typeof value === "object" && "configVersion" in value && "apple" in value);

/**
 * Translate an EAS Metadata config into ours.
 *
 * @param {any} store  parsed store.config.json
 * @returns {Record<string, any>}
 */
export function fromStoreConfig(store) {
  const apple = store?.apple ?? {};
  /** @type {Record<string, any>} */
  const out = {};

  const info = apple.info ?? {};
  const locales = Object.keys(info);
  if (locales.length) {
    const primary = locales.includes("en-US") ? "en-US" : locales[0];
    out.locale = primary;
    out.metadata = listing(info[primary]);
    if (locales.length > 1) {
      out.locales = Object.fromEntries(locales.filter((l) => l !== primary).map((l) => [l, listing(info[l])]));
    }
  }
  if (apple.copyright) out.metadata = { ...out.metadata, copyright: apple.copyright };

  if (apple.advisory) {
    const rating = Object.fromEntries(
      ADVISORY_KEYS.filter((k) => k in apple.advisory).map((k) => [k, apple.advisory[k]]),
    );
    if (apple.advisory.ageRatingOverrideV2) rating.override = apple.advisory.ageRatingOverrideV2;
    out.ageRating = rating;
  }

  if (Array.isArray(apple.categories) && apple.categories.length) {
    // A nested array is a parent and its subcategories (["GAMES", "GAMES_CARD"]);
    // the category id App Store Connect takes is the parent.
    const [primary, secondary] = apple.categories.map((c) => (Array.isArray(c) ? c[0] : c));
    out.category = secondary ? { primary, secondary } : { primary };
  }

  if (apple.release) {
    const auto = apple.release.automaticRelease;
    /** @type {Record<string, any>} */
    const release = {};
    if (typeof auto === "string") Object.assign(release, { type: "SCHEDULED", earliestDate: auto });
    else if (auto === true) release.type = "AFTER_APPROVAL";
    else if (auto === false) release.type = "MANUAL";
    if (typeof apple.release.phasedRelease === "boolean") release.phased = apple.release.phasedRelease;
    if (Object.keys(release).length) out.release = release;
  }

  if (apple.review) {
    out.review = Object.fromEntries(
      Object.entries(REVIEW_KEYS)
        .filter(([from]) => apple.review[from] !== undefined)
        .map(([from, to]) => [to, apple.review[from]]),
    );
  }
  return out;
}

/** @param {any} entry one locale of `apple.info` */
function listing(entry = {}) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [from, to] of Object.entries(INFO_KEYS)) if (entry[from] !== undefined) out[to] = entry[from];
  // EAS keeps keywords as an array; App Store Connect takes one comma-separated string.
  if (Array.isArray(entry.keywords)) out.keywords = entry.keywords.join(",");
  return out;
}

/**
 * Merge two configs, `over` winning. Objects merge key by key; arrays and
 * scalars are replaced.
 *
 * @param {Record<string, any>} base
 * @param {Record<string, any>} over
 */
export function mergeConfig(base, over) {
  /** @type {Record<string, any>} */
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const prev = out[key];
    out[key] =
      prev &&
      value &&
      typeof prev === "object" &&
      typeof value === "object" &&
      !Array.isArray(prev) &&
      !Array.isArray(value)
        ? mergeConfig(prev, value)
        : value;
  }
  return out;
}

/**
 * What an Expo project already knows: the bundle id (app.json), the App Store
 * Connect app id (eas.json's submit profile), and where its EAS Metadata is.
 *
 * @param {string} dir  the project directory
 * @param {string} [profile]  eas.json submit profile
 * @returns {{ bundleId?: string, ascAppId?: string, metadataPath?: string }}
 */
export function readExpoProject(dir, profile = "production") {
  const app = readJson(join(dir, "app.json"));
  const eas = readJson(join(dir, "eas.json"));
  const ios = eas?.submit?.[profile]?.ios ?? {};
  const metadataPath =
    ios.metadataPath ?? (existsSync(join(dir, "store.config.json")) ? "store.config.json" : undefined);
  return {
    bundleId: app?.expo?.ios?.bundleIdentifier ?? ios.bundleIdentifier,
    ascAppId: ios.ascAppId ? String(ios.ascAppId) : undefined,
    metadataPath: metadataPath?.endsWith(".json") ? metadataPath : undefined,
  };
}

/** @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
