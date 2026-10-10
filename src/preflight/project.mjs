// Read an app project from disk into one model the rules can query: what kind of
// project it is, what it depends on, the Info.plist keys it will ship with (from
// every place they can come from), its privacy manifests, and its source text.
// No network, and no project code is executed unless `expoConfig` is passed in.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { parsePlist } from "./plist.mjs";
import { EXPO_PERMISSION_PLUGINS } from "./data.mjs";

const SOURCE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".swift", ".m", ".mm"];
const SKIP_DIRS = new Set([
  "node_modules",
  "Pods",
  "android",
  "build",
  "dist",
  ".expo",
  ".git",
  "DerivedData",
  "__tests__",
  "__mocks__",
  "test",
  "tests",
  "e2e",
  "coverage",
  "web-build",
]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 20000;

/**
 * @typedef {Object} PlistEntry
 * @property {any} value
 * @property {string} source   where it came from: "app.json", "plugin expo-camera", "ios/App/Info.plist", "project.pbxproj"
 */

/**
 * @typedef {Object} Project
 * @property {string} dir
 * @property {boolean} found          anything recognisable as an app project
 * @property {boolean} expo
 * @property {boolean} native         an ios/ folder with an Xcode project (bare, or prebuilt Expo)
 * @property {boolean} managed        Expo without an ios/ folder: prebuild generates it
 * @property {Set<string>} deps
 * @property {any} expoConfig         the `expo` object, when readable
 * @property {boolean} dynamicConfig  app.config.js/ts exists and was not evaluated
 * @property {Map<string, PlistEntry>} infoPlist
 * @property {Array<{ source: string, types: Array<{ type: string, reasons: string[] }> }>} privacyManifests
 * @property {boolean} aggregationDisabled
 * @property {Array<{ file: string, text: string }>} sources
 * @property {string[]} notes         things the reader could not do, said plainly
 */

/**
 * @param {string} dir
 * @param {{ expoConfig?: any }} [options]  an already-evaluated `expo` config (`npx expo config --json`)
 * @returns {Project}
 */
export function loadProject(dir, { expoConfig } = {}) {
  /** @type {string[]} */
  const notes = [];
  const pkg = readJson(join(dir, "package.json"));
  const deps = new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})]);

  const appJson = readJson(join(dir, "app.json")) ?? readJson(join(dir, "app.config.json"));
  const dynamicFile = ["app.config.js", "app.config.ts", "app.config.mjs", "app.config.cjs"].find((f) =>
    existsSync(join(dir, f)),
  );
  const expo = expoConfig ?? appJson?.expo ?? (appJson && !appJson.expo && appJson.name ? appJson : null);
  const dynamicConfig = Boolean(dynamicFile && !expoConfig);
  if (dynamicConfig) notes.push(`${dynamicFile} was not evaluated; pass --expo-config to read it`);

  const iosDir = join(dir, "ios");
  const xcodeproj = isDir(iosDir) ? readdirSync(iosDir).find((f) => f.endsWith(".xcodeproj")) : undefined;
  const native = Boolean(xcodeproj) || hasXcodeProject(dir);
  const isExpo = deps.has("expo") || Boolean(expo);
  const managed = isExpo && !native;

  /** @type {Map<string, PlistEntry>} */
  const infoPlist = new Map();
  const set = (/** @type {string} */ key, /** @type {any} */ value, /** @type {string} */ source) => {
    if (value === undefined || value === null) return;
    infoPlist.set(key, { value, source });
  };

  // 1. Expo config: ios.infoPlist, then plugin options and their defaults, in
  //    Expo's own precedence (plugin option > ios.infoPlist > default; false removes).
  const appInfoPlist = expo?.ios?.infoPlist ?? {};
  for (const [k, v] of Object.entries(appInfoPlist)) set(k, v, "app.json ios.infoPlist");
  for (const [name, options] of pluginsOf(expo)) {
    for (const p of EXPO_PERMISSION_PLUGINS[name] ?? []) {
      const option = options?.[p.option];
      if (option === false) infoPlist.delete(p.key);
      else if (typeof option === "string") set(p.key, option, `plugin ${name}`);
      else if (!infoPlist.has(p.key)) set(p.key, p.default, `plugin ${name} (default text)`);
    }
  }
  if (typeof expo?.ios?.config?.usesNonExemptEncryption === "boolean") {
    set("ITSAppUsesNonExemptEncryption", expo.ios.config.usesNonExemptEncryption, "app.json ios.config");
  }

  // 2. Native: Info.plist files and INFOPLIST_KEY_* build settings override the
  //    Expo config — they are what actually ships once ios/ exists.
  const plists = findFiles(dir, (f) => f.endsWith("Info.plist"));
  for (const file of plists) {
    const parsed = parsePlist(readFileSync(file, "utf8"));
    if ("error" in parsed) {
      notes.push(`${rel(dir, file)}: ${parsed.error}, not read`);
      continue;
    }
    for (const [k, v] of Object.entries(parsed.value ?? {})) set(k, v, rel(dir, file));
  }
  for (const file of findFiles(dir, (f) => f.endsWith("project.pbxproj"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/INFOPLIST_KEY_(\w+)\s*=\s*("((?:[^"\\]|\\.)*)"|[^;\s]+)\s*;/g)) {
      const value = m[3] !== undefined ? m[3].replace(/\\"/g, '"') : m[2];
      set(m[1], value === "YES" ? true : value === "NO" ? false : value, rel(dir, file));
    }
  }

  // Privacy manifests: Expo's ios.privacyManifests, and every PrivacyInfo.xcprivacy outside Pods.
  const privacyManifests = [];
  if (expo?.ios?.privacyManifests) {
    privacyManifests.push({ source: "app.json ios.privacyManifests", types: accessedTypes(expo.ios.privacyManifests) });
  }
  for (const file of findFiles(dir, (f) => f.endsWith("PrivacyInfo.xcprivacy"))) {
    const parsed = parsePlist(readFileSync(file, "utf8"));
    if ("error" in parsed) {
      notes.push(`${rel(dir, file)}: ${parsed.error}, not read`);
      continue;
    }
    privacyManifests.push({ source: rel(dir, file), types: accessedTypes(parsed.value) });
  }
  const podfileProps = readJson(join(iosDir, "Podfile.properties.json"));
  const aggregationDisabled = podfileProps?.["apple.privacyManifestAggregationEnabled"] === "false";

  // Source text, bounded.
  const sources = [];
  let truncated = false;
  for (const file of findFiles(dir, (f) => SOURCE_EXTENSIONS.some((e) => f.endsWith(e)))) {
    if (sources.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    try {
      if (statSync(file).size > MAX_FILE_BYTES) continue;
      sources.push({ file: rel(dir, file), text: readFileSync(file, "utf8") });
    } catch {
      // unreadable: skip
    }
  }
  if (truncated) notes.push(`more than ${MAX_FILES} source files; only the first ${MAX_FILES} were scanned`);

  return {
    dir,
    found: Boolean(pkg || expo || native),
    expo: isExpo,
    native,
    managed,
    deps,
    expoConfig: expo,
    dynamicConfig,
    infoPlist,
    privacyManifests,
    aggregationDisabled,
    sources,
    notes,
  };
}

/**
 * Expo `plugins`: "name" or ["name", options].
 * @param {any} expo
 * @returns {Array<[string, any]>}
 */
function pluginsOf(expo) {
  return (expo?.plugins ?? []).map((p) => (Array.isArray(p) ? [p[0], p[1] ?? {}] : [p, {}]));
}

/** @param {any} manifest */
function accessedTypes(manifest) {
  return (manifest?.NSPrivacyAccessedAPITypes ?? []).map((t) => ({
    type: t?.NSPrivacyAccessedAPIType ?? "",
    reasons: Array.isArray(t?.NSPrivacyAccessedAPITypeReasons) ? t.NSPrivacyAccessedAPITypeReasons : [],
  }));
}

/** @param {string} dir */
function hasXcodeProject(dir) {
  try {
    return readdirSync(dir).some((f) => f.endsWith(".xcodeproj"));
  } catch {
    return false;
  }
}

/**
 * Files under `dir` matching `test`, skipping dependencies and build output.
 * @param {string} dir
 * @param {(path: string) => boolean} test
 * @returns {string[]}
 */
function findFiles(dir, test) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.endsWith("Tests") || e.name.endsWith("UITests")) continue;
        if (e.name.endsWith(".xcodeproj")) {
          if (test(join(p, "project.pbxproj"))) out.push(join(p, "project.pbxproj"));
          continue;
        }
        walk(p);
      } else if (test(p)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** @param {string} path */
function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** @param {string} root @param {string} file */
const rel = (root, file) => relative(root, file).split(sep).join("/");
