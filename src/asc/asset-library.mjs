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
 * @property {Array<{ specId: string, shortName?: string, fileExtensions?: string[], duration?: { min?: string|number, max?: string|number },
 *   dimensions: { minWidth: number, maxWidth: number, minHeight: number, maxHeight: number } }>} [videoSpecs]
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
        `/v1/appAssetLibraryRefData?fields[appAssetLibraryRefData]=placementProfileGroups,imageSpecs,videoSpecs,placementTypes,features`,
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
  return placementLimit(ref, placementGroupId, "APP_SCREENSHOT", 10);
}

/**
 * The most assets of a placement type a group may hold on an App Store version.
 * @param {RefData} ref @param {string} placementGroupId @param {string} placementType @param {number} fallback
 */
export function placementLimit(ref, placementGroupId, placementType, fallback, featureId = "APP_STORE_VERSIONS") {
  // The feature's own policy first (custom product pages have theirs), then the
  // product page's, then the fallback.
  for (const id of [featureId, "APP_STORE_VERSIONS"]) {
    const feature = (ref.features ?? []).find((f) => f.featureId === id);
    const policy = feature?.placementPolicies?.find((p) => p.placementType === placementType);
    const limit = policy?.groupLimits?.find((g) => g.groupIds.includes(placementGroupId));
    if (limit?.maxCount != null) return limit.maxCount;
  }
  return fallback;
}

/**
 * Preview placement groups that accept a video of these dimensions, with the
 * matching specification — the video twin of groupsForImage.
 *
 * @param {RefData} ref
 * @param {{ width: number, height: number }} dims
 * @returns {Array<{ placementGroupId: string, platform?: string, spec: NonNullable<RefData["videoSpecs"]>[number] }>}
 */
export function groupsForVideo(ref, { width, height }) {
  const specs = new Map(
    (ref.videoSpecs ?? [])
      .filter(
        (s) =>
          width >= s.dimensions.minWidth &&
          width <= s.dimensions.maxWidth &&
          height >= s.dimensions.minHeight &&
          height <= s.dimensions.maxHeight,
      )
      .map((s) => [s.specId, s]),
  );
  const type = (ref.placementTypes ?? []).find((t) => t.placementTypeId === "APP_PREVIEW");
  const profiles = new Map((ref.placementProfileGroups ?? []).map((g) => [g.placementProfileGroupId, g]));
  const out = [];
  for (const mapping of type?.specMappings ?? []) {
    const specId = mapping.specs.find((id) => specs.has(id));
    if (!specId) continue;
    out.push({
      placementGroupId: mapping.placementGroupId,
      platform: profiles.get(mapping.placementGroupId)?.platform,
      spec: /** @type {any} */ (specs.get(specId)),
    });
  }
  return out;
}

/** Every preview size Apple offers, as "W×H (group)", for messages. @param {RefData} ref */
export function previewSizes(ref) {
  const type = (ref.placementTypes ?? []).find((t) => t.placementTypeId === "APP_PREVIEW");
  const specs = new Map((ref.videoSpecs ?? []).map((s) => [s.specId, s]));
  return (type?.specMappings ?? []).flatMap((m) =>
    m.specs
      .map((id) => specs.get(id))
      .filter(Boolean)
      .map((s) => `${s?.dimensions.minWidth}×${s?.dimensions.minHeight} (${m.placementGroupId})`),
  );
}

/**
 * Seconds in an ISO 8601 duration ("PT30S", "PT1M5S") or a plain number; null
 * when it cannot be read, so an unknown format never rejects a file.
 * @param {string|number|undefined} value
 */
export function durationSeconds(value) {
  if (typeof value === "number") return value;
  const m = /^P(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)$/.exec(String(value ?? ""));
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
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
 * The same reconciliation serves screenshots (images, APP_SCREENSHOT) and app
 * previews (videos, APP_PREVIEW), on a version's localization or a custom
 * product page's.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{
 *   library: { id: string },
 *   localizationId?: string,
 *   parent?: { type: "appStoreVersionLocalizations" | "appCustomProductPageLocalizations" | "appStoreVersionExperimentTreatmentLocalizations", id: string },
 *   media?: "image" | "video",
 *   previewFrameTimeCode?: string,
 *   placementGroup: string,
 *   local: Array<{ file: string, path: string, size: number }>,
 *   prune: boolean,
 *   checkOnly?: boolean,
 * }} params
 *   `checkOnly`: write nothing, only say whether the placements differ — how a
 *   custom product page decides whether its approved version needs a new one.
 */
export async function syncPlacements({ client, uploader, dryRun }, params) {
  const { library, placementGroup, local, prune, media = "image", previewFrameTimeCode } = params;
  const parent = params.parent ?? {
    type: "appStoreVersionLocalizations",
    id: /** @type {string} */ (params.localizationId),
  };
  const parentKey = /** @type {Record<string, string>} */ ({
    appStoreVersionLocalizations: "appStoreVersionLocalization",
    appCustomProductPageLocalizations: "appCustomProductPageLocalization",
    appStoreVersionExperimentTreatmentLocalizations: "appStoreVersionExperimentTreatmentLocalization",
  })[parent.type];
  const assetType = media === "video" ? "appAssetLibraryVideos" : "appAssetLibraryImages";
  const placementType = media === "video" ? "APP_PREVIEW" : "APP_SCREENSHOT";
  const isPlanned = (/** @type {string} */ id) => String(id).startsWith("dry:");

  const current = isPlanned(parent.id)
    ? { data: [], included: [] }
    : await client.get(
        `/v1/${parent.type}/${parent.id}/placements` +
          `?filter[placementType]=${placementType}&filter[placementGroup]=${encodeURIComponent(placementGroup)}` +
          `&sort=placementGroupPosition&include=${media}&fields[${assetType}]=referenceName,fileName,state${media === "video" ? ",previewFrameTimeCode" : ""}` +
          `&limit=50`,
      );
  const images = new Map((current.included ?? []).filter((x) => x.type === assetType).map((x) => [x.id, x]));
  const placed = (current.data ?? []).map((p) => {
    const image = images.get(p.relationships?.[media]?.data?.id);
    return {
      id: p.id,
      assetId: image?.id,
      tag: tagOf(image?.attributes?.referenceName),
      imageState: image?.attributes?.state,
      fileName: image?.attributes?.fileName,
      frame: image?.attributes?.previewFrameTimeCode ?? null,
    };
  });

  /** A placed video whose poster frame is not the configured one. @param {{ frame: string|null }} p */
  const wrongFrame = (p) => media === "video" && Boolean(previewFrameTimeCode) && p.frame !== previewFrameTimeCode;

  if (params.checkOnly) {
    const live = placed.filter((p) => !DEAD_ASSET_STATES.includes(p.imageState ?? ""));
    const want = local.map((item) => contentTag(readFileSync(item.path)));
    const differs =
      want.some((tag, i) => live[i]?.tag !== tag || (live[i] && wrongFrame(live[i]))) ||
      (params.prune ? live.length !== want.length : live.length < want.length);
    return {
      uploaded: [],
      reused: [],
      deleted: [],
      keptOrphans: [],
      unchanged: 0,
      reordered: false,
      changed: differs,
      planned: true,
    };
  }

  const claimed = new Set();
  /** @type {string[]} */
  const ordered = [];
  let reframed = 0;
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
      // Same video, new poster frame: the asset is updated, not uploaded again.
      if (wrongFrame(existing) && existing.assetId) {
        await client.patch(`/v1/appAssetLibraryVideos/${existing.assetId}`, {
          data: { type: "appAssetLibraryVideos", id: existing.assetId, attributes: { previewFrameTimeCode } },
        });
        reframed += 1;
      }
      continue;
    }

    const referenceName = `${basename(item.file)} [asr:${tag}]`;
    const found = isPlanned(library.id) ? null : await findLibraryAsset(client, library.id, referenceName, media);
    let imageId = found?.id ?? null;
    if (found && imageId) {
      reused.push(item.file);
      if (wrongFrame(found)) {
        await client.patch(`/v1/appAssetLibraryVideos/${imageId}`, {
          data: { type: "appAssetLibraryVideos", id: imageId, attributes: { previewFrameTimeCode } },
        });
      }
    } else {
      imageId = await uploader.upload({
        reservePath: `/v1/${assetType}`,
        type: assetType,
        attributes: {
          category: "APP_SCREENSHOTS_AND_PREVIEWS",
          referenceName,
          ...(media === "video" && previewFrameTimeCode ? { previewFrameTimeCode } : {}),
        },
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
          attributes: { placementType, placementGroup },
          relationships: {
            [media]: { data: { type: assetType, id: imageId } },
            [parentKey]: { data: { type: parent.type, id: parent.id } },
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
          [parentKey]: { data: { type: parent.type, id: parent.id } },
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
    changed: Boolean(created || toDelete.length || reframed || (reordered && desired.length > 1)),
    planned: dryRun,
  };
}

/**
 * A processed (or processing) asset in the library with exactly this reference
 * name — the same bytes, uploaded earlier, perhaps for another locale.
 *
 * @param {import("./client.mjs").AscClient} client
 * @param {string} libraryId
 * @param {string} referenceName
 * @param {"image"|"video"} media
 */
async function findLibraryAsset(client, libraryId, referenceName, media) {
  const kind = media === "video" ? "videos" : "images";
  const fields = media === "video" ? "appAssetLibraryVideos" : "appAssetLibraryImages";
  const r = await client.get(
    `/v1/appAssetLibraries/${libraryId}/${kind}?filter[referenceName]=${encodeURIComponent(referenceName)}` +
      `&fields[${fields}]=referenceName,state${media === "video" ? ",previewFrameTimeCode" : ""}&limit=5`,
    { throwOnError: false },
  );
  if (r.error) return null;
  const hit = (r.data ?? []).find(
    (img) => img.attributes?.referenceName === referenceName && !DEAD_ASSET_STATES.includes(img.attributes?.state),
  );
  return hit ? { id: hit.id, frame: hit.attributes?.previewFrameTimeCode ?? null } : null;
}
/**
 * Placements of one media kind on a parent, in device groups the local folder no
 * longer has any file for: deleted, or only counted with `checkOnly`. Without
 * this, removing every iPad file would leave the iPad placements live, since
 * the per-group sync only visits groups that still have files.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ parent: { type: string, id: string }, media: "image"|"video", keep: string[], checkOnly?: boolean }} params
 * @returns {Promise<number>}
 */
export async function pruneOtherGroups({ client }, { parent, media, keep, checkOnly = false }) {
  if (String(parent.id).startsWith("dry:")) return 0;
  const placementType = media === "video" ? "APP_PREVIEW" : "APP_SCREENSHOT";
  const placed = await client.all(`/v1/${parent.type}/${parent.id}/placements?filter[placementType]=${placementType}`, {
    limit: 50,
  });
  const stray = placed.filter((p) => !keep.includes(p.attributes?.placementGroup));
  if (!checkOnly) for (const p of stray) await client.delete(`/v1/appAssetLibraryPlacements/${p.id}`);
  return stray.length;
}
