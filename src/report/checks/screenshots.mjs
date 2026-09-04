// Screenshots, checked on both sides: what App Store Connect holds, and whether
// the local PNGs are even the right shape to upload.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";
import { readPngHeader, DISPLAY_TYPE_SIZES } from "../../asc/png.mjs";

export const section = { id: "screenshots", title: "Screenshots" };

/** @param {{ snapshot: any, config: any, resolvePath?: (p: string, purpose?: string) => string }} input */
export function check({ snapshot, config, resolvePath }) {
  const out = [];
  if (!snapshot.version) return out;

  const displayType = config?.screenshots?.displayType ?? "APP_IPHONE_67";
  const set = snapshot.screenshotSets.find((s) => s.displayType === displayType);
  const remote = set?.screenshots ?? [];

  if (!remote.length) {
    out.push(
      finding({
        id: "screenshots.count.zero",
        category: Category.ASC_STATE,
        title: `No ${displayType} screenshots uploaded`,
        detail: "App Store Connect requires at least one screenshot for the primary display size.",
        fix: "Put exact-size PNGs in config.screenshots.dir and upload them.",
        fixCommand: "appstore-release screenshots",
        docs: "references/screenshots.md",
      }),
    );
  } else {
    const incomplete = remote.filter((s) => s.state !== "COMPLETE");
    if (incomplete.length) {
      out.push(
        finding({
          id: "screenshots.upload.incomplete",
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

  // Local assets: dimensions and alpha, before any network call. Apple rejects
  // both, and finding out at upload time costs a round trip per file.
  const dir = config?.screenshots?.dir;
  if (dir && resolvePath) {
    let abs;
    try {
      abs = resolvePath(dir, "config.screenshots.dir");
    } catch (e) {
      out.push(
        finding({
          id: "screenshots.dir.unreadable",
          category: Category.ASSET,
          title: "config.screenshots.dir is not usable",
          detail: e instanceof Error ? e.message : String(e),
          fix: "Point config.screenshots.dir at a directory inside your project.",
        }),
      );
      return out;
    }

    if (!existsSync(abs)) {
      out.push(
        finding({
          id: "screenshots.dir.missing",
          category: Category.ASSET,
          title: "The screenshot directory does not exist",
          detail: `Looked in ${abs} (resolved from "${dir}" relative to the config).`,
          fix: "Create the directory and put the PNGs in it, or fix config.screenshots.dir.",
        }),
      );
      return out;
    }

    const expected = DISPLAY_TYPE_SIZES[displayType];
    const files = readdirSync(abs).filter((f) => f.toLowerCase().endsWith(".png"));
    for (const file of files) {
      const header = readPngHeader(join(abs, file));
      if (!header) continue;
      if (expected && (header.width !== expected.width || header.height !== expected.height)) {
        out.push(
          finding({
            id: "screenshots.dimensions.invalid",
            category: Category.ASSET,
            title: `${file} is the wrong size for ${displayType}`,
            detail: `It is ${header.width}×${header.height}; Apple accepts exactly ${expected.width}×${expected.height}.`,
            fixOwner: FixOwner.EXTERNAL,
            fix: `Re-render ${file} at ${expected.width}×${expected.height}.`,
            evidence: { expected, actual: { width: header.width, height: header.height } },
            docs: "references/screenshots.md",
          }),
        );
      }
    }
  }

  return out;
}
