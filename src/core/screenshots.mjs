// Which screenshot files belong to which locale and display type.
//
// The old config named one directory and one display type, which meant an app
// supporting iPad simply could not be submitted — Apple requires an iPad set
// when the build declares tablet support, and the tool had no way to express one.
//
// Three shapes are accepted, cheapest first:
//   dir: "./shots"                       one display type, one locale
//   sets: [{ displayType, dir }]         several display types
//   dir + per-locale subdirectories      ./shots/tr/*.png overrides ./shots/*.png
//
// A set may name an App Asset Library `placementGroup` instead of (or as well as)
// a legacy `displayType` — the only way to target groups the old enumeration
// never had, such as iPhone Duo. With neither, the asset-library path infers the
// group from the files' pixel size.
//
// The subdirectory convention is what keeps a multi-locale, multi-device config
// from turning into a matrix the user has to write out by hand.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_DISPLAY_TYPE = "APP_IPHONE_67";

/**
 * @typedef {Object} ScreenshotSet
 * @property {string} displayType    legacy display type ("" when only a placement group is given)
 * @property {string|null} placementGroup  App Asset Library placement group, when configured
 * @property {string} key            what findings and summaries call this set
 * @property {string} locale
 * @property {string} dir            absolute
 * @property {string[]} files        PNG filenames, in display order
 */

/**
 * Every set this config asks for, resolved against the filesystem.
 *
 * @param {object} config
 * @param {(p: string, purpose?: string) => string} resolvePath
 * @param {string[]} locales
 * @param {{ displayType?: string }} [overrides]
 * @returns {{ sets: ScreenshotSet[], missing: Array<{displayType: string, key: string, locale: string, dir: string}> }}
 */
export function resolveScreenshotSets(config, resolvePath, locales, overrides = {}) {
  const cfg = config.screenshots ?? {};
  const declared = declaredSets(config, overrides).map((d, i) => ({
    ...d,
    dir: cfg.sets?.length ? (cfg.sets[i].dir ?? cfg.dir) : cfg.dir,
  }));

  /** @type {ScreenshotSet[]} */
  const sets = [];
  /** @type {Array<{displayType: string, key: string, locale: string, dir: string}>} */
  const missing = [];

  for (const entry of declared) {
    if (!entry.dir) continue;
    const base = resolvePath(entry.dir, "config.screenshots.dir");
    for (const locale of locales) {
      // A per-locale subdirectory wins; otherwise every locale shares the files
      // in the base directory, which is what a single-language app wants.
      const localeDir = join(base, locale);
      const dir = isDirectory(localeDir) ? localeDir : base;
      if (!isDirectory(dir)) {
        missing.push({ displayType: entry.displayType, key: entry.key, locale, dir });
        continue;
      }
      const files = readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(".png"))
        .sort(); // filename order is display order
      if (!files.length) {
        missing.push({ displayType: entry.displayType, key: entry.key, locale, dir });
        continue;
      }
      sets.push({
        displayType: entry.displayType,
        placementGroup: entry.placementGroup,
        key: entry.key,
        locale,
        dir,
        files,
      });
    }
  }

  return { sets, missing };
}

function isDirectory(path) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The sets this config declares, without touching the filesystem.
 *
 * @param {object} config
 * @param {{ displayType?: string }} [overrides]
 * @returns {Array<{ displayType: string, placementGroup: string|null, key: string }>}
 */
export function declaredSets(config, overrides = {}) {
  const cfg = /** @type {any} */ (config)?.screenshots ?? {};
  const entries = cfg.sets?.length
    ? cfg.sets.map((/** @type {any} */ s) => ({ displayType: s.displayType, placementGroup: s.placementGroup }))
    : [{ displayType: overrides.displayType ?? cfg.displayType, placementGroup: cfg.placementGroup }];
  return entries.map((/** @type {any} */ e) => {
    const placementGroup = e.placementGroup ?? null;
    const displayType = e.displayType ?? (placementGroup ? "" : DEFAULT_DISPLAY_TYPE);
    return { displayType, placementGroup, key: placementGroup ?? displayType };
  });
}

/** The display types this config asks for, deduplicated. @param {object} config */
export function declaredDisplayTypes(config) {
  return [
    ...new Set(
      declaredSets(config)
        .map((s) => s.displayType)
        .filter(Boolean),
    ),
  ];
}
