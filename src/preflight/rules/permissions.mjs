// Guideline 5.1.1(ii): "Ensure your purpose strings clearly and completely
// describe your use of the data." A usage description that is missing makes the
// app crash when it asks; one left at a generic default reads as no explanation.
//
// A missing key is always a warning: it is inferred — from a dependency that
// may never ask, or from a symbol in the source that may be used for something
// else (a torch, a save-only photo write) — never read off the app.

import { EXPO_DEFAULT_TEXTS, EXPO_PERMISSION_PLUGINS, NATIVE_PERMISSION_SYMBOLS } from "../data.mjs";
import { appFinding, locate, Severity } from "./util.mjs";

/** Shorter than this, a purpose string cannot say what the data is for. */
const MIN_PURPOSE_LENGTH = 20;

/** @param {import("../project.mjs").Project} project */
export function permissions(project) {
  const out = [];
  /** @type {Map<string, { why: string, where: any }>} */
  const needed = new Map();

  // Packages that request a permission at runtime.
  for (const [pkg, perms] of Object.entries(EXPO_PERMISSION_PLUGINS)) {
    if (!project.deps.has(pkg)) continue;
    // Only the first key is the package's own; the rest are options it can use
    // (expo-image-picker can use the camera) and are checked only if present.
    const primary = perms[0];
    if (!needed.has(primary.key)) needed.set(primary.key, { why: pkg, where: null });
  }
  // Native APIs used directly.
  for (const { symbol, key, what } of NATIVE_PERMISSION_SYMBOLS) {
    const where = locate(
      { ...project, sources: project.sources.filter((s) => /\.(swift|m|mm)$/.test(s.file)) },
      symbol,
    );
    if (where && !needed.has(key)) needed.set(key, { why: `${what} (${symbol.source.replace(/\\b/g, "")})`, where });
  }

  for (const [key, { why, where }] of needed) {
    // Turned off on purpose with the plugin's `false` option.
    if (project.infoPlist.has(key) || project.disabledKeys.has(key)) continue;
    const plugin = Object.entries(EXPO_PERMISSION_PLUGINS).find(([, list]) => list.some((p) => p.key === key));
    const option = plugin?.[1].find((p) => p.key === key)?.option;
    out.push(
      appFinding({
        id: `app.permission.missing.${key}`,
        guideline: "5.1.1(ii)",
        severity: Severity.WARNING,
        title: `No ${key}, but the app uses ${why}`,
        detail:
          "If the app asks for this access, iOS terminates it without a usage description, and App Review rejects it. " +
          "Inferred from the dependency or the code; if the app never asks, waive it in preflight.ignore.",
        fix:
          project.expo && plugin && option
            ? `Add ["${plugin[0]}", { "${option}": "<what you use it for, in the user's terms>" }] to expo.plugins in app.json.`
            : `Add ${key} to Info.plist, saying what the app uses it for.`,
        ...(where ? { location: where } : {}),
      }),
    );
  }

  // Every usage description present: is it specific?
  for (const [key, { value, source }] of project.infoPlist) {
    if (!/UsageDescription$/.test(key) || typeof value !== "string") continue;
    const generic = EXPO_DEFAULT_TEXTS.has(value.trim());
    const short = value.replace(/\$\(PRODUCT_NAME\)/g, "").trim().length < MIN_PURPOSE_LENGTH;
    if (!generic && !short) continue;
    out.push(
      appFinding({
        id: `app.permission.default-text.${key}`,
        guideline: "5.1.1(ii)",
        severity: Severity.WARNING,
        title: generic ? `${key} is Expo's default text` : `${key} is too short to explain anything`,
        detail: `"${value}" (from ${source}). Apple asks purpose strings to clearly and completely describe the use — what, and why it helps the user.`,
        fix: 'Say what the app does with it, e.g. "Scan receipts so your expenses fill in automatically."',
        evidence: { actual: value, resource: source },
      }),
    );
  }
  return out;
}
