// Binary asset upload. Single responsibility: the ASC reserve → upload → commit
// dance, shared by app screenshots and subscription review screenshots.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

export class AssetUploader {
  /** @param {import("./client.mjs").AscClient} client */
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {{ reservePath: string, type: string, relationships: object,
   *           filePath: string, fileName?: string }} params
   * @returns {Promise<string>} the created asset id
   */
  async upload({ reservePath, type, relationships, filePath, fileName }) {
    const bytes = readFileSync(filePath);
    const name = fileName || filePath.split("/").pop();

    // 1. Reserve — ASC returns pre-signed upload operations.
    const reserved = (
      await this.client.post(reservePath, {
        data: { type, attributes: { fileName: name, fileSize: bytes.length }, relationships },
      })
    ).data;

    // 2. Upload each chunk to its pre-signed URL.
    for (const op of reserved.attributes.uploadOperations) {
      const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
      const res = await fetch(op.url, {
        method: op.method,
        headers,
        body: bytes.subarray(op.offset, op.offset + op.length),
      });
      if (!res.ok) throw new Error(`Upload chunk failed for ${name}: HTTP ${res.status}`);
    }

    // 3. Commit with the md5 checksum.
    const checksum = crypto.createHash("md5").update(bytes).digest("hex");
    await this.client.patch(`/v1/${reserved.type}/${reserved.id}`, {
      data: { type: reserved.type, id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
    });

    return reserved.id;
  }
}
