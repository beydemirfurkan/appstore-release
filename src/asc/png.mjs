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
 * Exact pixel sizes App Store Connect accepts, by screenshot display type.
 * There is no APP_IPHONE_69 — 1290×2796 satisfies both 6.7" and 6.9".
 */
export const DISPLAY_TYPE_SIZES = Object.freeze({
  APP_IPHONE_67: { width: 1290, height: 2796 },
  APP_IPHONE_65: { width: 1242, height: 2688 },
  APP_IPHONE_61: { width: 1179, height: 2556 },
  APP_IPHONE_58: { width: 1125, height: 2436 },
  APP_IPHONE_55: { width: 1242, height: 2208 },
  APP_IPAD_PRO_3GEN_129: { width: 2048, height: 2732 },
  APP_IPAD_PRO_129: { width: 2048, height: 2732 },
  APP_IPAD_PRO_3GEN_11: { width: 1668, height: 2388 },
});
