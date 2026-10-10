// The App Asset Library (App Store Connect API 4.5.1) — the replacement for the
// deprecated screenshot sets, and the only way to upload iPhone Duo screenshots.
//
// The model, in Apple's words: upload each file once into a per-app library, then
// create placements that position it on surfaces. Three things differ from the
// set-based API, and each is a trap for code carried over from it:
//
//   - Device targets are not an enumeration. Placement groups and their exact
//     pixel specifications come from GET /v1/appAssetLibraryRefData at runtime;
//     Apple adds device families there without an API version change.
//   - The commit takes `uploaded: true` alone. There is no checksum — so Apple
//     no longer hands one back to diff against. We embed a content hash in the
//     asset's referenceName instead, which keeps re-runs free.
//   - Deletes do not cascade. An asset with placements cannot be deleted
//     (STATE_ERROR.ASSET_HAS_PLACEMENTS); placements go first. We only ever
//     delete placements, and leave unplaced assets in the library, which Apple
//     documents as harmless.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** What we put in referenceName so a later run recognises the same bytes. */
const HASH_TAG = /\[asr:([0-9a-f]{16})\]$/;

/** States in which a library image is unusable and should be replaced, not placed. */
const DEAD_ASSET_STATES = ["FAILED", "AWAITING_UPLOAD"];

/**
 * @typedef {Object} RefData
 * @property {Array<{ placementProfileGroupId: string, platform: string, displayClassId: string }>} placementProfileGroups
 * @property {Array<{ specId: string, shortName?: string, alphaAllowed?: boolean, fileExtensions?: string[],
 *   dimensions: { minWidth: number, maxWidth: number, minHeight: number, maxHeight: number } }>} imageSpecs
 * @property {Array<{ placementTypeId: string, acceptsAssetCategories?: string[],
 *   specMappings: Array<{ placementGroupId: string, specs: string[] }> }>} placementTypes
 * @property {Array<{ featureId: string, placementPolicies: Array<{ placementType: string,
 *   groupLimits: Array<{ groupIds: string[], maxCount: number }> }> }>} [features]
 */

export class AssetLibrary {
  /**
   * @param {import("./client.mjs").AscClient} client
   * @param {string} appId
   */
  constructor(client, appId) {
    this.client = client;
    this.appId = appId;
    /** @type {Promise<any>|null} */
    this._library = null;
    /** @type {Promise<RefData|null>|null} */
    this._ref = null;
  }

  /**
   * The app's library, or null when this account or app has none — which is how
   * the `auto` backend decides to fall back to screenshot sets.
   */
  library() {
    this._library ??= this.client
      .get(`/v1/apps/${this.appId}/assetLibrary`, { throwOnError: false })
      .then((r) => (r.error ? null : (r.data ?? null)));
    return this._library;
  }

  /** The specification catalog. Read once per run, never embedded. */
  refData() {
    this._ref ??= this.client
      .get(
        `/v1/appAssetLibraryRefData?fields[appAssetLibraryRefData]=placementProfileGroups,imageSpecs,placementTypes,features`,
        { throwOnError: false },
      )
      .then((r) => {
        if (r.error) return null;
        const datum = Array.isArray(r.data) ? r.data[0] : r.data;
        return datum?.attributes ?? null;
      });
    return this._ref;
  }
}

/**
 * Screenshot placement groups that accept an image of these dimensions, with the
 * matching specification. Apple's specs are exact (min equals max), and a
 * landscape file matches a landscape spec, so no orientation guessing happens.
 *
 * @param {RefData} ref
 * @param {{ width: number, height: number }} dims
 * @param {string} [placementType]
 * @returns {Array<{ placementGroupId: string, platform?: string, displayClassId?: string, spec: RefData["imageSpecs"][number] }>}
 */
export function groupsForImage(ref, { width, height }, placementType = "APP_SCREENSHOT") {
  const specs = new Map(
    (ref.imageSpecs ?? [])
      .filter(
        (s) =>
          width >= s.dimensions.minWidth &&
          width <= s.dimensions.maxWidth &&
          height >= s.dimensions.minHeight &&
          height <= s.dimensions.maxHeight,
      )
      .map((s) => [s.specId, s]),
  );
  const type = (ref.placementTypes ?? []).find((t) => t.placementTypeId === placementType);
  const profiles = new Map((ref.placementProfileGroups ?? []).map((g) => [g.placementProfileGroupId, g]));

  const out = [];
  for (const mapping of type?.specMappings ?? []) {
    const specId = mapping.specs.find((id) => specs.has(id));
    if (!specId) continue;
    const profile = profiles.get(mapping.placementGroupId);
    out.push({
      placementGroupId: mapping.placementGroupId,
      platform: profile?.platform,
      displayClassId: profile?.displayClassId,
      spec: /** @type {any} */ (specs.get(specId)),
    });
  }
  return out;
}

/**
 * Every screenshot placement group Apple currently offers, for `--list-groups`.
 *
 * @param {RefData} ref
 * @returns {Array<{ placementGroupId: string, platform?: string, displayClassId?: string, sizes: string[] }>}
 */
export function listScreenshotGroups(ref) {
  const type = (ref.placementTypes ?? []).find((t) => t.placementTypeId === "APP_SCREENSHOT");
  const specs = new Map((ref.imageSpecs ?? []).map((s) => [s.specId, s]));
  const profiles = new Map((ref.placementProfileGroups ?? []).map((g) => [g.placementProfileGroupId, g]));
  return (type?.specMappings ?? []).map((m) => ({
    placementGroupId: m.placementGroupId,
    platform: profiles.get(m.placementGroupId)?.platform,
    displayClassId: profiles.get(m.placementGroupId)?.displayClassId,
    sizes: m.specs
      .map((id) => specs.get(id)?.dimensions)
      .filter(Boolean)
      .map((d) => `${d?.minWidth}×${d?.minHeight}`),
  }));
}

/**
 * The most screenshots a group may hold on an App Store version. Read, not
 * assumed: Apple states it per feature, and it is 10 today.
 *
 * @param {RefData} ref
 * @param {string} placementGroupId
 */
export function screenshotLimit(ref, placementGroupId) {
  const feature = (ref.features ?? []).find((f) => f.featureId === "APP_STORE_VERSIONS");
  const policy = feature?.placementPolicies?.find((p) => p.placementType === "APP_SCREENSHOT");
  const limit = policy?.groupLimits?.find((g) => g.groupIds.includes(placementGroupId));
  return limit?.maxCount ?? 10;
}

/** The content hash we tag assets with: 16 hex chars of sha256. @param {Buffer} bytes */
export const contentTag = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** @param {string|null|undefined} referenceName */
export const tagOf = (referenceName) => HASH_TAG.exec(referenceName ?? "")?.[1] ?? null;

/**
 * Reconcile one placement group in one version localization with an ordered list
 * of local files: reuse what is already placed, reuse library assets with the
 * same bytes (so ten locales sharing a screenshot upload it once), upload the
 * rest, drop or keep orphans, and send an ordering request only when the order
 * is actually wrong.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{
 *   library: { id: string },
 *   localizationId: string,
 *   placementGroup: string,
 *   local: Array<{ file: string, path: string, size: number }>,
 *   prune: boolean,
 * }} params
 */
export async function syncPlacements({ client, uploader, dryRun }, params) {
  const { library, localizationId, placementGroup, local, prune } = params;
  const isPlanned = (/** @type {string} */ id) => String(id).startsWith("dry:");

  const current = isPlanned(localizationId)
    ? { data: [], included: [] }
    : await client.get(
        `/v1/appStoreVersionLocalizations/${localizationId}/placements` +
          `?filter[placementType]=APP_SCREENSHOT&filter[placementGroup]=${encodeURIComponent(placementGroup)}` +
          `&sort=placementGroupPosition&include=image&fields[appAssetLibraryImages]=referenceName,fileName,state` +
          `&limit=50`,
      );
  const images = new Map(
    (current.included ?? []).filter((x) => x.type === "appAssetLibraryImages").map((x) => [x.id, x]),
  );
  const placed = (current.data ?? []).map((p) => {
    const image = images.get(p.relationships?.image?.data?.id);
    return {
      id: p.id,
      tag: tagOf(image?.attributes?.referenceName),
      imageState: image?.attributes?.state,
      fileName: image?.attributes?.fileName,
    };
  });

  const claimed = new Set();
  /** @type {string[]} */
  const ordered = [];
  /** @type {string[]} */
  const uploaded = [];
  /** @type {string[]} */
  const reused = [];

  for (const item of local) {
    const bytes = readFileSync(item.path);
    const tag = contentTag(bytes);

    const existing = placed.find(
      (p) => !claimed.has(p.id) && p.tag === tag && !DEAD_ASSET_STATES.includes(p.imageState ?? ""),
    );
    if (existing) {
      claimed.add(existing.id);
      ordered.push(existing.id);
      continue;
    }

    const referenceName = `${basename(item.file)} [asr:${tag}]`;
    let imageId = isPlanned(library.id) ? null : await findLibraryImage(client, library.id, referenceName);
    if (imageId) {
      reused.push(item.file);
    } else {
      imageId = await uploader.upload({
        reservePath: `/v1/appAssetLibraryImages`,
        type: "appAssetLibraryImages",
        attributes: { category: "APP_SCREENSHOTS_AND_PREVIEWS", referenceName },
        relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: library.id } } },
        filePath: item.path,
        fileName: basename(item.file),
        commit: "uploaded",
      });
      uploaded.push(item.file);
    }

    const placement = (
      await client.post(`/v1/appAssetLibraryPlacements`, {
        data: {
          type: "appAssetLibraryPlacements",
          attributes: { placementType: "APP_SCREENSHOT", placementGroup },
          relationships: {
            image: { data: { type: "appAssetLibraryImages", id: imageId } },
            appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } },
          },
        },
      })
    ).data;
    ordered.push(placement.id);
  }

  // Placements of assets that failed processing always go; real orphans only
  // when asked. Deleting a placement leaves its asset in the library.
  const leftovers = placed.filter((p) => !claimed.has(p.id));
  const dead = leftovers.filter((p) => DEAD_ASSET_STATES.includes(p.imageState ?? ""));
  const orphans = leftovers.filter((p) => !dead.includes(p));
  const toDelete = [...dead, ...(prune ? orphans : [])];
  for (const p of toDelete) await client.delete(`/v1/appAssetLibraryPlacements/${p.id}`);

  // Orphans that stay keep their place after ours; comparing against that full
  // sequence is what keeps a no-prune re-run from reordering every time.
  const desired = [...ordered, ...(prune ? [] : orphans.map((p) => p.id))];
  const before = placed.filter((p) => !toDelete.includes(p)).map((p) => p.id);
  const reordered = desired.length !== before.length || desired.some((id, i) => id !== before[i]);
  if (reordered && desired.length > 1) {
    await client.post(`/v1/appAssetLibraryPlacementOrderingRequests`, {
      data: {
        type: "appAssetLibraryPlacementOrderingRequests",
        attributes: { placementGroup },
        relationships: {
          orderedPlacements: { data: desired.map((id) => ({ type: "appAssetLibraryPlacements", id })) },
          appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } },
        },
      },
    });
  }

  const created = ordered.filter((id) => !placed.some((p) => p.id === id)).length;
  return {
    uploaded,
    reused,
    deleted: toDelete.map((p) => p.fileName ?? p.id),
    keptOrphans: prune ? [] : orphans.map((p) => p.fileName ?? p.id),
    unchanged: local.length - created,
    reordered: reordered && desired.length > 1,
    changed: Boolean(created || toDelete.length || (reordered && desired.length > 1)),
    planned: dryRun,
  };
}

/**
 * A processed (or processing) image in the library with exactly this reference
 * name — the same bytes, uploaded earlier, perhaps for another locale.
 *
 * @param {import("./client.mjs").AscClient} client
 * @param {string} libraryId
 * @param {string} referenceName
 */
async function findLibraryImage(client, libraryId, referenceName) {
  const r = await client.get(
    `/v1/appAssetLibraries/${libraryId}/images?filter[referenceName]=${encodeURIComponent(referenceName)}` +
      `&fields[appAssetLibraryImages]=referenceName,state&limit=5`,
    { throwOnError: false },
  );
  if (r.error) return null;
  const hit = (r.data ?? []).find(
    (img) => img.attributes?.referenceName === referenceName && !DEAD_ASSET_STATES.includes(img.attributes?.state),
  );
  return hit?.id ?? null;
}
