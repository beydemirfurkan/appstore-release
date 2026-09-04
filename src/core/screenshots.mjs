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
// The subdirectory convention is what keeps a multi-locale, multi-device config
// from turning into a matrix the user has to write out by hand.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_DISPLAY_TYPE = "APP_IPHONE_67";

/**
 * @typedef {Object} ScreenshotSet
 * @property {string} displayType
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
 * @returns {{ sets: ScreenshotSet[], missing: Array<{displayType: string, locale: string, dir: string}> }}
 */
export function resolveScreenshotSets(config, resolvePath, locales, overrides = {}) {
  const cfg = config.screenshots ?? {};
  const declared = cfg.sets?.length
    ? cfg.sets.map((s) => ({ displayType: s.displayType ?? DEFAULT_DISPLAY_TYPE, dir: s.dir ?? cfg.dir }))
    : [{ displayType: overrides.displayType ?? cfg.displayType ?? DEFAULT_DISPLAY_TYPE, dir: cfg.dir }];

  /** @type {ScreenshotSet[]} */
  const sets = [];
  /** @type {Array<{displayType: string, locale: string, dir: string}>} */
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
        missing.push({ displayType: entry.displayType, locale, dir });
        continue;
      }
      const files = readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(".png"))
        .sort(); // filename order is display order
      if (!files.length) {
        missing.push({ displayType: entry.displayType, locale, dir });
        continue;
      }
      sets.push({ displayType: entry.displayType, locale, dir, files });
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

/** The display types this config asks for, deduplicated. @param {object} config */
export function declaredDisplayTypes(config) {
  const cfg = config?.screenshots ?? {};
  if (cfg.sets?.length) return [...new Set(cfg.sets.map((s) => s.displayType ?? DEFAULT_DISPLAY_TYPE))];
  return [cfg.displayType ?? DEFAULT_DISPLAY_TYPE];
}
