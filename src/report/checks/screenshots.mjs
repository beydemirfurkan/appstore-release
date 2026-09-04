// Screenshots, checked on both sides: what App Store Connect holds, and whether
// the local PNGs are even the right shape to upload.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";
import { readPngHeader, DISPLAY_TYPE_SIZES } from "../../asc/png.mjs";
import { localeCodes } from "../../core/locales.mjs";
import { resolveScreenshotSets, declaredDisplayTypes } from "../../core/screenshots.mjs";

export const section = { id: "screenshots", title: "Screenshots" };

const IPAD_TYPES = ["APP_IPAD_PRO_3GEN_129", "APP_IPAD_PRO_129", "APP_IPAD_PRO_3GEN_11"];

/** @param {{ snapshot: any, config: any, resolvePath?: (p: string, purpose?: string) => string }} input */
export function check({ snapshot, config, resolvePath }) {
  const out = [];
  if (!snapshot.version) return out;

  const locales = snapshot.locales?.length ? snapshot.locales : localeCodes(config);
  const displayTypes = declaredDisplayTypes(config);
  const multi = displayTypes.length > 1 || locales.length > 1;
  /** Only qualify a finding id when there is more than one set to confuse it with. */
  const suffix = (dt, locale) => (multi ? `.${dt}.${locale}` : "");

  // What App Store Connect currently holds, per declared set.
  for (const displayType of displayTypes) {
    for (const locale of locales) {
      const set = snapshot.screenshotSets.find((s) => s.displayType === displayType && s.locale === locale);
      const remote = set?.screenshots ?? [];

      if (!remote.length) {
        out.push(
          finding({
            id: `screenshots.count.zero${suffix(displayType, locale)}`,
            category: Category.ASC_STATE,
            title: multi
              ? `No ${displayType} screenshots uploaded for ${locale}`
              : `No ${displayType} screenshots uploaded`,
            detail: "App Store Connect requires at least one screenshot for each declared display size.",
            fix: "Put exact-size PNGs in the configured directory and upload them.",
            fixCommand: "appstore-release screenshots",
            docs: "references/screenshots.md",
          }),
        );
        continue;
      }

      const incomplete = remote.filter((s) => s.state !== "COMPLETE");
      if (incomplete.length) {
        out.push(
          finding({
            id: `screenshots.upload.incomplete${suffix(displayType, locale)}`,
            category: Category.ASC_STATE,
            title: `${incomplete.length} of ${remote.length} screenshots never finished uploading`,
            detail:
              "These were reserved but not committed, so Apple will not use them. " +
              `Stuck: ${incomplete.map((s) => s.fileName).join(", ")}.`,
            fix: "Re-run the screenshots operation; it re-uploads anything not COMPLETE.",
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
  const hasIpadRemote = snapshot.screenshotSets.some((s) => IPAD_TYPES.includes(s.displayType));
  const declaresIpad = displayTypes.some((d) => IPAD_TYPES.includes(d));
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

  // Local assets: dimensions, before any network call.
  if (!resolvePath || !config?.screenshots) return out;

  const { sets, missing } = resolveScreenshotSets(config, resolvePath, locales);
  for (const m of missing) {
    out.push(
      finding({
        id: `screenshots.dir.missing${suffix(m.displayType, m.locale)}`,
        category: Category.ASSET,
        title: multi ? `No local ${m.displayType} PNGs for ${m.locale}` : "The screenshot directory has no PNGs",
        detail: `Looked in ${m.dir}.`,
        fixOwner: FixOwner.EXTERNAL,
        fix: `Put exact-size PNGs there, or in a "${m.locale}" subdirectory of the configured directory.`,
      }),
    );
  }

  for (const set of sets) {
    const expected = DISPLAY_TYPE_SIZES[set.displayType];
    if (!expected) continue;
    for (const file of set.files) {
      const header = readPngHeader(`${set.dir}/${file}`);
      if (!header) continue;
      if (header.width === expected.width && header.height === expected.height) continue;
      out.push(
        finding({
          id: `screenshots.dimensions.invalid.${set.displayType}.${file}`,
          category: Category.ASSET,
          title: `${file} is the wrong size for ${set.displayType}`,
          detail: `It is ${header.width}×${header.height}; Apple accepts exactly ${expected.width}×${expected.height}.`,
          fixOwner: FixOwner.EXTERNAL,
          fix: `Re-render ${file} at ${expected.width}×${expected.height}.`,
          evidence: { expected, actual: { width: header.width, height: header.height } },
          docs: "references/screenshots.md",
        }),
      );
    }
  }

  return out;
}
