// Screenshots, checked on both sides: what App Store Connect holds, and whether
// the local PNGs are even the right shape to upload.
//
// App Store Connect holds screenshots in one of two places since API 4.5.1 —
// the deprecated screenshot sets, or App Asset Library placements — and an app
// can be anywhere in between. A declared set counts as covered by either.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";
import { readPngHeader, fitsDisplayType, describeSizes, displayTypeForSize } from "../../asc/png.mjs";
import { localeCodes } from "../../core/locales.mjs";
import { resolveScreenshotSets, declaredSets } from "../../core/screenshots.mjs";

export const section = { id: "screenshots", title: "Screenshots" };

const IPAD_TYPES = ["APP_IPAD_PRO_3GEN_129", "APP_IPAD_PRO_129", "APP_IPAD_PRO_3GEN_11"];

/** Apple: iPhone Duo screenshots are required for apps built with the iOS 27.1 SDK, from April 2027. */
export const DUO_REQUIRED_FROM = "2027-04-01";

/** Asset states that mean the file will never be shown. */
const DEAD_ASSET_STATES = ["FAILED", "AWAITING_UPLOAD"];

/**
 * @param {{ snapshot: any, config: any, resolvePath?: (p: string, purpose?: string) => string, now?: number }} input
 */
export function check({ snapshot, config, resolvePath, now = Date.now() }) {
  const out = [];
  if (!snapshot.version) return out;

  const locales = snapshot.locales?.length ? snapshot.locales : localeCodes(config);
  // With `from`, the sets are whatever the export folder holds, by pixel size.
  const declared =
    config?.screenshots?.from && resolvePath
      ? [
          ...new Map(
            resolveScreenshotSets(config, resolvePath, locales).sets.map((x) => [
              x.key,
              { displayType: x.displayType, placementGroup: null, key: x.key },
            ]),
          ).values(),
        ]
      : declaredSets(config);
  const placements = snapshot.placements ?? [];
  const multi = declared.length > 1 || locales.length > 1;
  /** Only qualify a finding id when there is more than one set to confuse it with. */
  const suffix = (/** @type {string} */ key, /** @type {string} */ locale) => (multi ? `.${key}.${locale}` : "");

  // What App Store Connect currently holds, per declared set.
  for (const set of declared) {
    for (const locale of locales) {
      const legacy = set.displayType
        ? (snapshot.screenshotSets.find((s) => s.displayType === set.displayType && s.locale === locale)?.screenshots ??
          [])
        : [];
      const placed = placements.filter(
        (p) =>
          p.locale === locale &&
          (set.placementGroup
            ? p.placementGroup === set.placementGroup
            : set.displayType
              ? p.width && p.height && displayTypeForSize(p.width, p.height) === set.displayType
              : // a size-keyed set from `screenshots.from`, e.g. "1398x2034"
                p.width && p.height && `${Math.min(p.width, p.height)}x${Math.max(p.width, p.height)}` === set.key),
      );

      if (!legacy.length && !placed.length) {
        out.push(
          finding({
            id: `screenshots.count.zero${suffix(set.key, locale)}`,
            category: Category.ASC_STATE,
            title: multi ? `No ${set.key} screenshots · ${locale}` : `No ${set.key} screenshots`,
            detail: "App Store Connect requires at least one screenshot for each declared display size.",
            fix: "Put exact-size PNGs in the configured directory and upload them.",
            fixCommand: "appstore-release screenshots",
            docs: "references/screenshots.md",
          }),
        );
        continue;
      }

      const incomplete = [
        ...legacy.filter((s) => s.state !== "COMPLETE").map((s) => s.fileName),
        ...placed.filter((p) => DEAD_ASSET_STATES.includes(p.assetState)).map((p) => p.fileName ?? p.id),
      ];
      if (incomplete.length) {
        out.push(
          finding({
            id: `screenshots.upload.incomplete${suffix(set.key, locale)}`,
            category: Category.ASC_STATE,
            title: `${incomplete.length} of ${legacy.length + placed.length} screenshots never finished uploading`,
            detail:
              "These were reserved but not committed, or failed processing, so Apple will not use them. " +
              `Stuck: ${incomplete.join(", ")}.`,
            fix: "Re-run the screenshots operation; it replaces anything that never completed.",
            fixCommand: "appstore-release screenshots",
            docs: "references/gotchas.md#screenshots",
          }),
        );
      }
    }
  }

  // Apple rejects a tablet-capable build with no iPad screenshots, but the API
  // does not expose the build's device families anywhere we could read them — so
  // this does not claim to detect that. What it can see is iPad screenshots that
  // already exist and are not in the config, which we would otherwise leave
  // looking managed when they are not.
  const hasIpadRemote =
    snapshot.screenshotSets.some((s) => IPAD_TYPES.includes(s.displayType)) ||
    placements.some((p) => /IPAD/.test(p.placementGroup ?? ""));
  const declaresIpad = declared.some((d) => IPAD_TYPES.includes(d.displayType) || /IPAD/.test(d.placementGroup ?? ""));
  if (hasIpadRemote && !declaresIpad) {
    out.push(
      finding({
        id: "screenshots.family.unmanaged",
        severity: Severity.WARNING,
        category: Category.CONFIG,
        title: "iPad screenshots exist in App Store Connect but are not in your config",
        detail: "They will not be checked or updated here.",
        fixOwner: FixOwner.CLI,
        fix: "Add an entry to config.screenshots.sets for the iPad display type to manage them.",
      }),
    );
  }

  // iPhone Duo. We cannot read which SDK a build used, so this is advice rather
  // than a verdict until the date Apple set, and a warning after it.
  const hasDuo =
    placements.some((p) => /DUO/.test(p.placementGroup ?? "")) ||
    declared.some((d) => /DUO/.test(d.placementGroup ?? ""));
  if (!hasDuo && declared.some((d) => !IPAD_TYPES.includes(d.displayType))) {
    const due = now >= Date.parse(DUO_REQUIRED_FROM);
    out.push(
      finding({
        id: "screenshots.duo.missing",
        severity: due ? Severity.WARNING : Severity.INFO,
        category: Category.CONFIG,
        title: due
          ? "No iPhone Duo screenshots — required for apps built with the iOS 27.1 SDK"
          : "No iPhone Duo screenshots yet — required from April 2027 for apps built with the iOS 27.1 SDK",
        detail:
          "iPhone Duo screenshots exist only in the App Asset Library: outer display 1398×2034, inner 2007×2853 " +
          "(or landscape). Builds made with Xcode 27.1 or later need them.",
        fixOwner: FixOwner.EXTERNAL,
        fix: "Capture Duo screenshots and add a set with its placementGroup (see `appstore-release screenshots --list-groups`).",
        docs: "references/screenshots.md",
      }),
    );
  }

  if (config?.screenshots?.api === "legacy") {
    out.push(
      finding({
        id: "screenshots.api.legacy",
        severity: Severity.INFO,
        category: Category.CONFIG,
        title: 'screenshots.api is "legacy": the deprecated screenshot-set API',
        detail: "Apple deprecated screenshot sets in App Store Connect API 4.5.1 in favour of the App Asset Library.",
        fixOwner: FixOwner.CLI,
        fix: 'Remove screenshots.api, or set it to "auto".',
      }),
    );
  }

  // Local assets: dimensions and alpha, before any network call. Placement-group
  // sets are checked against Apple's catalog at upload time instead.
  if (!resolvePath || !config?.screenshots) return out;

  const { sets, missing } = resolveScreenshotSets(config, resolvePath, locales);
  for (const m of missing) {
    out.push(
      finding({
        id: `screenshots.dir.missing${suffix(m.key, m.locale)}`,
        category: Category.ASSET,
        title: multi ? `No local ${m.key} PNGs for ${m.locale}` : "The screenshot directory has no PNGs",
        detail: `Looked in ${m.dir}.`,
        fixOwner: FixOwner.EXTERNAL,
        fix: `Put exact-size PNGs there, or in a "${m.locale}" subdirectory of the configured directory.`,
      }),
    );
  }

  for (const set of sets) {
    for (const file of set.files) {
      const header = readPngHeader(`${set.dir}/${file}`);
      if (!header) continue;
      if (set.displayType && !fitsDisplayType(set.displayType, header.width, header.height)) {
        out.push(
          finding({
            id: `screenshots.dimensions.invalid.${set.key}.${file}`,
            category: Category.ASSET,
            title: `${file} is the wrong size for ${set.displayType}`,
            detail: `It is ${header.width}×${header.height}; Apple accepts ${describeSizes(set.displayType)} (or landscape).`,
            fixOwner: FixOwner.EXTERNAL,
            fix: `Re-render ${file} at one of those sizes.`,
            evidence: {
              expected: describeSizes(set.displayType),
              actual: { width: header.width, height: header.height },
            },
            docs: "references/screenshots.md",
          }),
        );
      } else if (header.hasAlpha) {
        out.push(
          finding({
            id: `screenshots.alpha.${set.key}.${file}`,
            category: Category.ASSET,
            title: `${file} has an alpha channel`,
            detail: "App Store screenshots must be opaque; Apple rejects transparency.",
            fixOwner: FixOwner.EXTERNAL,
            fix: `Flatten ${file} onto an opaque background and export it without alpha.`,
            docs: "references/screenshots.md",
          }),
        );
      }
    }
  }

  return out;
}
