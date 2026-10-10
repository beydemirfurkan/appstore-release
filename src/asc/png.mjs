// Read a PNG's dimensions and alpha channel from its header, with no dependency
// and no `sips` — which means screenshot validation works on Linux and in CI,
// not only on the maintainer's Mac.
//
// The IHDR chunk is always first and always 13 bytes, so 33 bytes is enough.

import { openSync, readSync, closeSync } from "node:fs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Colour types that carry an alpha channel. Apple rejects alpha in app icons. */
const ALPHA_COLOR_TYPES = new Set([4, 6]);

/**
 * @param {string} filePath
 * @returns {{ width: number, height: number, bitDepth: number, colorType: number, hasAlpha: boolean } | null}
 *          null when the file is unreadable or not a PNG
 */
export function readPngHeader(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const head = Buffer.alloc(33);
    const read = readSync(fd, head, 0, 33, 0);
    if (read < 33) return null;
    if (!head.subarray(0, 8).equals(SIGNATURE)) return null;
    if (head.subarray(12, 16).toString("latin1") !== "IHDR") return null;

    const colorType = head.readUInt8(25);
    return {
      width: head.readUInt32BE(16),
      height: head.readUInt32BE(20),
      bitDepth: head.readUInt8(24),
      colorType,
      hasAlpha: ALPHA_COLOR_TYPES.has(colorType),
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Pixel sizes App Store Connect accepts for each legacy screenshot display type,
 * portrait; the landscape orientation (width and height swapped) is accepted too.
 * There is no APP_IPHONE_69 — the 6.9" sizes belong to APP_IPHONE_67, and the
 * 6.3" sizes to APP_IPHONE_61.
 *
 * This table is for the deprecated screenshot-set API only. The App Asset
 * Library publishes its specifications at runtime (appAssetLibraryRefData) and
 * that catalog, not this list, is what the asset-library path checks against —
 * which is how iPhone Duo sizes work without a release of this tool.
 */
export const DISPLAY_TYPE_SIZES = Object.freeze({
  APP_IPHONE_67: [size(1320, 2868), size(1290, 2796), size(1260, 2736)],
  APP_IPHONE_65: [size(1284, 2778), size(1242, 2688)],
  APP_IPHONE_61: [size(1206, 2622), size(1179, 2556)],
  APP_IPHONE_58: [size(1170, 2532), size(1125, 2436), size(1080, 2340)],
  APP_IPHONE_55: [size(1242, 2208)],
  APP_IPAD_PRO_3GEN_129: [size(2064, 2752), size(2048, 2732)],
  APP_IPAD_PRO_129: [size(2048, 2732)],
  APP_IPAD_PRO_3GEN_11: [size(1668, 2420), size(1668, 2388), size(1640, 2360), size(1488, 2266)],
});

/** @param {number} width @param {number} height */
function size(width, height) {
  return Object.freeze({ width, height });
}

/**
 * Whether a file of these dimensions is accepted for a display type, in either
 * orientation. Unknown display types are not second-guessed.
 *
 * @param {string} displayType
 * @param {number} width
 * @param {number} height
 */
export function fitsDisplayType(displayType, width, height) {
  const sizes = /** @type {Record<string, Array<{width:number,height:number}>>} */ (DISPLAY_TYPE_SIZES)[displayType];
  if (!sizes) return true;
  return sizes.some((s) => (s.width === width && s.height === height) || (s.width === height && s.height === width));
}

/** "1320×2868, 1290×2796 or 1260×2736" @param {string} displayType */
export function describeSizes(displayType) {
  const sizes =
    /** @type {Record<string, Array<{width:number,height:number}>>} */ (DISPLAY_TYPE_SIZES)[displayType] ?? [];
  const labels = sizes.map((s) => `${s.width}×${s.height}`);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}` : (labels[0] ?? "the exact size");
}

/**
 * The legacy display type a processed image of this size counts towards — used
 * to read Asset Library placements against a config written in display types.
 *
 * @param {number} width
 * @param {number} height
 * @returns {string|null}
 */
export function displayTypeForSize(width, height) {
  for (const displayType of Object.keys(DISPLAY_TYPE_SIZES)) {
    if (fitsDisplayType(displayType, width, height)) return displayType;
  }
  return null;
}
