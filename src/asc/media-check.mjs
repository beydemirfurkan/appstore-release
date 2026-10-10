// The checks every screenshot or preview folder goes through before a byte is
// sent: readable, an exact size Apple's catalog has, one device group (or the
// one the config names among several), no alpha where the spec forbids it, a
// preview length inside the spec, and no more files than the group allows.
// Shared by previews and custom product pages, so neither skips one.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { finding, Category, FixOwner } from "../core/findings.mjs";
import { readPngHeader } from "./png.mjs";
import { readVideoHeader } from "./video.mjs";
import {
  durationSeconds,
  groupsForImage,
  groupsForVideo,
  listScreenshotGroups,
  placementLimit,
  previewSizes,
} from "./asset-library.mjs";

export const EXTENSIONS = Object.freeze({ image: [".png"], video: [".mov", ".mp4", ".m4v"] });

/**
 * Files of one media kind in a folder, in name order (the order they are shown).
 * @param {string} dir @param {"image"|"video"} media
 */
export function mediaFiles(dir, media) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => EXTENSIONS[media].some((e) => f.toLowerCase().endsWith(e)))
    .sort();
}

/**
 * @param {{
 *   dir: string,
 *   media: "image"|"video",
 *   ref: import("./asset-library.mjs").RefData,
 *   placementGroup?: string,
 *   feature?: string,
 *   idPrefix: string,
 *   where: string,
 * }} input
 * @returns {{ sets: Array<{ group: string, local: Array<{ file: string, path: string, size: number }> }>, findings: import("../core/findings.mjs").Finding[] }}
 */
export function planMedia({ dir, media, ref, placementGroup, feature = "APP_STORE_VERSIONS", idPrefix, where }) {
  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = [];
  const problem = (/** @type {string} */ file, /** @type {string} */ title, /** @type {string} */ fix) =>
    findings.push(
      finding({
        id: `${idPrefix}.file.${file}`,
        category: Category.ASSET,
        title,
        detail: where,
        fixOwner: FixOwner.EXTERNAL,
        fix,
      }),
    );
  const sizes = () =>
    media === "video"
      ? previewSizes(ref).join(", ")
      : listScreenshotGroups(ref)
          .map((g) => `${g.sizes.join("/")} (${g.placementGroupId})`)
          .join(", ");

  /** @type {Map<string, Array<{ file: string, path: string, size: number }>>} */
  const byGroup = new Map();
  for (const file of mediaFiles(dir, media)) {
    const path = join(dir, file);
    const header = media === "video" ? readVideoHeader(path) : readPngHeader(path);
    if (!header) {
      problem(file, `${file} cannot be read`, media === "video" ? "Export it as .mov or .mp4." : "Export it as PNG.");
      continue;
    }
    const candidates = (media === "video" ? groupsForVideo(ref, header) : groupsForImage(ref, header)).filter(
      (c) => !c.placementGroupId.startsWith("IMESSAGE_"),
    );
    // The configured group settles a tie; it never overrides a size with one answer.
    const chosen =
      candidates.length === 1 ? candidates[0] : candidates.find((c) => c.placementGroupId === placementGroup);
    if (!chosen) {
      problem(
        file,
        candidates.length
          ? `${file} (${header.width}×${header.height}) fits several device groups: ${candidates.map((c) => c.placementGroupId).join(", ")}`
          : `No ${media === "video" ? "app preview" : "screenshot"} size is ${header.width}×${header.height}`,
        candidates.length ? "Name the one you mean in placementGroup." : `Re-render at one of: ${sizes()}.`,
      );
      continue;
    }
    if (
      media === "image" &&
      /** @type {any} */ (header).hasAlpha &&
      /** @type {any} */ (chosen.spec).alphaAllowed === false
    ) {
      problem(
        file,
        `${file} has an alpha channel, which App Store screenshots may not`,
        "Export it without transparency.",
      );
      continue;
    }
    if (media === "video") {
      const secs = /** @type {any} */ (header).durationSeconds;
      const min = durationSeconds(/** @type {any} */ (chosen.spec).duration?.min);
      const max = durationSeconds(/** @type {any} */ (chosen.spec).duration?.max);
      if (secs != null && ((min != null && secs < min) || (max != null && secs > max))) {
        problem(
          file,
          `${file} is ${Math.round(secs * 10) / 10} seconds; previews run ${min ?? "?"}–${max ?? "?"} seconds`,
          "Trim or extend it.",
        );
        continue;
      }
    }
    const list = byGroup.get(chosen.placementGroupId) ?? [];
    list.push({ file, path, size: statSync(path).size });
    byGroup.set(chosen.placementGroupId, list);
  }

  const placementType = media === "video" ? "APP_PREVIEW" : "APP_SCREENSHOT";
  const sets = [];
  for (const [group, local] of byGroup) {
    const limit = placementLimit(ref, group, placementType, media === "video" ? 3 : 10, feature);
    if (local.length > limit) {
      problem(
        `${group}-count`,
        `${local.length} ${media === "video" ? "previews" : "screenshots"} for ${group}, but Apple allows ${limit}`,
        `Keep at most ${limit}.`,
      );
      continue;
    }
    sets.push({ group, local });
  }
  return { sets, findings };
}
