// Read an app preview's pixel size and length from the file itself, with no
// dependency and no ffprobe — so a wrong-size preview is caught before an
// upload of a few hundred megabytes, on any platform.
//
// MP4 and QuickTime (.mov) are both ISO base media files: a sequence of boxes
// (4-byte size, 4-byte type). `moov` holds the movie header (`mvhd`: timescale
// and duration) and one `trak` per track; a video track's `tkhd` carries its
// display width and height as 16.16 fixed point. Only box headers are read
// until `moov` is found, so the media data (`mdat`) is never loaded.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Containers worth descending into on the way to the video track header. */
const CONTAINERS = new Set(["moov", "trak", "mdia"]);

/**
 * @param {string} filePath
 * @returns {{ width: number, height: number, durationSeconds: number | null } | null}
 *          null when the file is unreadable or has no video track; durationSeconds
 *          null when the file does not say (a fragmented file without mehd)
 */
export function readVideoHeader(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const size = fstatSync(fd).size;
    const moov = findTopLevel(fd, size, "moov");
    if (!moov) return null;
    const buf = Buffer.alloc(moov.length);
    readSync(fd, buf, 0, moov.length, moov.offset);
    return parseMoov(buf);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The body of the first top-level box of this type, by header reads alone.
 * @param {number} fd @param {number} size @param {string} type
 */
function findTopLevel(fd, size, type) {
  const head = Buffer.alloc(16);
  let pos = 0;
  while (pos + 8 <= size) {
    readSync(fd, head, 0, 16, pos);
    let boxSize = head.readUInt32BE(0);
    const boxType = head.toString("latin1", 4, 8);
    let headerSize = 8;
    if (boxSize === 1) {
      boxSize = Number(head.readBigUInt64BE(8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - pos; // to the end of the file
    }
    if (boxSize < headerSize) return null;
    if (boxType === type)
      return { offset: pos + headerSize, length: Math.min(boxSize - headerSize, size - pos - headerSize) };
    pos += boxSize;
  }
  return null;
}

/**
 * Iterate the boxes inside a buffer.
 * @param {Buffer} buf
 * @returns {Generator<{ type: string, body: Buffer }>}
 */
function* boxes(buf) {
  let pos = 0;
  while (pos + 8 <= buf.length) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = buf.length - pos;
    }
    if (size < header || pos + size > buf.length) return;
    yield { type, body: buf.subarray(pos + header, pos + size) };
    pos += size;
  }
}

/** @param {Buffer} moov */
function parseMoov(moov) {
  let durationSeconds = 0;
  let timescaleOf = 0;
  let fragmentDuration = 0;
  /** @type {{ width: number, height: number } | null} */
  let video = null;

  for (const box of boxes(moov)) {
    if (box.type === "mvhd") {
      const version = box.body.readUInt8(0);
      const timescale = version === 1 ? box.body.readUInt32BE(20) : box.body.readUInt32BE(12);
      const duration = version === 1 ? Number(box.body.readBigUInt64BE(24)) : box.body.readUInt32BE(16);
      timescaleOf = timescale;
      if (timescale) durationSeconds = duration / timescale;
    } else if (box.type === "mvex") {
      // A fragmented file's movie header says 0; its length is in mvex/mehd.
      for (const inner of boxes(box.body)) {
        if (inner.type !== "mehd") continue;
        const version = inner.body.readUInt8(0);
        fragmentDuration = version === 1 ? Number(inner.body.readBigUInt64BE(4)) : inner.body.readUInt32BE(4);
      }
    } else if (box.type === "trak" && !video) {
      video = videoTrack(box.body);
    }
  }
  if (!durationSeconds && fragmentDuration && timescaleOf) durationSeconds = fragmentDuration / timescaleOf;
  const found = /** @type {{ width: number, height: number } | null} */ (video);
  return found ? { width: found.width, height: found.height, durationSeconds: durationSeconds || null } : null;
}

/**
 * The display size of a track, when it is a video track (`hdlr` type `vide`).
 * @param {Buffer} trak
 */
function videoTrack(trak) {
  /** @type {{ width: number, height: number } | null} */
  let size = null;
  let isVideo = false;
  const walk = (/** @type {Buffer} */ buf) => {
    for (const box of boxes(buf)) {
      if (box.type === "tkhd") {
        // The last 44 bytes: a 3×3 matrix {a, b, u, c, d, v, x, y, w}, then width
        // and height in 16.16 fixed point. The size is before the matrix: a
        // portrait recording is often stored landscape with a quarter turn
        // (a = d = 0), so the displayed size is the other way round.
        const end = box.body.length;
        const width = box.body.readUInt32BE(end - 8) >>> 16;
        const height = box.body.readUInt32BE(end - 4) >>> 16;
        const a = box.body.readInt32BE(end - 44);
        const d = box.body.readInt32BE(end - 28);
        size = a === 0 && d === 0 ? { width: height, height: width } : { width, height };
      } else if (box.type === "hdlr") {
        isVideo = box.body.toString("latin1", 8, 12) === "vide";
      } else if (CONTAINERS.has(box.type)) {
        walk(box.body);
      }
    }
  };
  walk(trak);
  return isVideo && size && /** @type {any} */ (size).width ? size : null;
}

/**
 * A minimal, valid-enough MP4 of a given size and length, for tests and demos:
 * ftyp, an empty mdat, and a moov with mvhd and one video trak (tkhd, mdia/hdlr).
 *
 * @param {{ width: number, height: number, durationSeconds: number, padding?: number, quarterTurn?: boolean }} spec
 * @returns {Buffer}
 */
export function minimalMp4({ width, height, durationSeconds, padding = 0, quarterTurn = false }) {
  const box = (/** @type {string} */ type, /** @type {Buffer[]} */ ...parts) => {
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body]);
  };
  const timescale = 600;
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(durationSeconds * timescale), 16);
  const tkhd = Buffer.alloc(84);
  // identity matrix, or a quarter turn (a = d = 0, b = 1, c = -1)
  tkhd.writeInt32BE(quarterTurn ? 0 : 0x10000, 40);
  tkhd.writeInt32BE(quarterTurn ? 0x10000 : 0, 44);
  tkhd.writeInt32BE(quarterTurn ? -0x10000 : 0, 52);
  tkhd.writeInt32BE(quarterTurn ? 0 : 0x10000, 56);
  tkhd.writeInt32BE(0x40000000, 72);
  tkhd.writeUInt32BE(width << 16, 76);
  tkhd.writeUInt32BE(height << 16, 80);
  const hdlr = Buffer.alloc(24);
  hdlr.write("vide", 8, "latin1");
  return Buffer.concat([
    box("ftyp", Buffer.from("isom\0\0\x02\0isommp41", "latin1")),
    box("mdat", Buffer.alloc(padding)),
    box("moov", box("mvhd", mvhd), box("trak", box("tkhd", tkhd), box("mdia", box("hdlr", hdlr)))),
  ]);
}
