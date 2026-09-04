// Binary asset upload. Single responsibility: the ASC reserve → upload → commit
// dance, shared by app screenshots and subscription review screenshots.
//
// The commit is the step everyone gets wrong: skip it and the asset sits in ASC
// forever as "reserved", which is what leaves a subscription stuck in
// MISSING_METADATA with nothing in the UI to explain why.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export class AssetUploader {
  /** @param {import("./client.mjs").AscClient} client */
  constructor(client) {
    this.client = client;
  }

  /**
   * Hash a local file the way ASC expects for the commit step. Exposed because
   * the diffing in the screenshots operation compares this against the
   * `sourceFileChecksum` ASC already holds, to avoid re-uploading what matches.
   *
   * @param {string} filePath
   * @returns {{ bytes: Buffer, checksum: string, size: number }}
   */
  static read(filePath) {
    const bytes = readFileSync(filePath);
    return { bytes, checksum: crypto.createHash("md5").update(bytes).digest("hex"), size: bytes.length };
  }

  /**
   * @param {{ reservePath: string, type: string, relationships: object,
   *           filePath: string, fileName?: string }} params
   * @returns {Promise<string>} the created asset id
   */
  async upload({ reservePath, type, relationships, filePath, fileName }) {
    // Read before anything else, so a missing or unreadable file fails locally
    // rather than after we have reserved a slot in App Store Connect. Under dry
    // run this is the whole point: the file still gets read and validated.
    const { bytes, checksum, size } = AssetUploader.read(filePath);
    const name = fileName || basename(filePath);

    // 1. Reserve — ASC returns pre-signed upload operations.
    const reserved = (
      await this.client.post(reservePath, {
        data: { type, attributes: { fileName: name, fileSize: size }, relationships },
      })
    ).data;

    if (this.client.dryRun) return reserved.id;

    // 2. Upload each chunk to its pre-signed URL. These URLs carry their own
    //    auth, so they go through uploadChunk rather than request().
    for (const op of reserved.attributes.uploadOperations) {
      await this.client.uploadChunk({
        url: op.url,
        method: op.method,
        headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])),
        body: bytes.subarray(op.offset, op.offset + op.length),
      });
    }

    // 3. Commit with the md5 checksum. BASE_URL has no /v1, so this path needs it.
    await this.client.patch(`/v1/${reserved.type}/${reserved.id}`, {
      data: { type: reserved.type, id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
    });

    return reserved.id;
  }
}
