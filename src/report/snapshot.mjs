// One read-only pass over App Store Connect, producing a plain object. No
// judgement lives here — the checks in ./checks/ decide what any of it means.
//
// Splitting inventory from judgement is what makes the checks pure functions over
// a fixture, so the readiness report can be tested without a network at all.

/**
 * @typedef {Object} AppSnapshot
 * @property {string} generatedAt
 * @property {any} app
 * @property {any} version              the editable one, or null
 * @property {any[]} versions           every version, newest first
 * @property {any} build                attached to `version`, or null
 * @property {any[]} latestBuilds       recent uploads, for "is one ready to attach"
 * @property {any} appInfo
 * @property {any[]} appInfoIncluded
 * @property {any[]} localizations
 * @property {any[]} screenshotSets       legacy screenshot sets
 * @property {any[]} placements           App Asset Library screenshot placements
 * @property {any} pricing
 * @property {any[]} subscriptions
 * @property {any[]} inAppPurchases
 * @property {any} reviewDetail
 * @property {any} submission
 * @property {string|null} locale       the primary locale the report is about
 * @property {string[]} locales         every locale the config describes
 * @property {string[]} errors          sections we could not read, by name
 * @property {import("../preflight/index.mjs").PreflightResult} [preflight]  the app on disk, read offline (set by getReadinessReport)
 */

import { localeCodes } from "../core/locales.mjs";
import { isCurrentVersionState, pickEditableAppInfo, versionState } from "../core/status.mjs";

/**
 * Gather everything the readiness checks need.
 *
 * Every section is independently guarded: a 403 on one endpoint (an API key
 * without the right role, say) must still leave a usable report for the rest,
 * with the gap named in `errors` rather than silently absent.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ locale?: string }} [opts]
 * @returns {Promise<AppSnapshot>}
 */
export async function getAppSnapshot(ctx, { locale } = {}) {
  const { client, appId } = ctx;
  // Every locale the config describes is inspected, not just the primary one —
  // a half-filled secondary localization is exactly what Apple rejects.
  const configured = localeCodes(ctx.config);
  const wanted = locale ? [locale] : configured;
  const primary = wanted[0] ?? null;
  /** @type {string[]} */
  const errors = [];

  /** Run a section, recording rather than propagating its failure. */
  const section = async (name, fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };

  const app = await section("app", async () => (await client.get(`/v1/apps/${appId}`)).data, null);

  const versions = await section(
    "versions",
    () =>
      client.all(
        `/v1/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString,appStoreState,appVersionState,platform,copyright`,
        { limit: 50 },
      ),
    [],
  );
  // Deliberately null rather than "whatever came back first": targeting a live
  // version because no editable one exists is worse than reporting that fact.
  const version = versions.find((v) => isCurrentVersionState(versionState(v))) ?? null;

  const build = version
    ? await section(
        "build",
        async () => {
          const r = await client.get(
            `/v1/appStoreVersions/${version.id}/build?fields[builds]=version,processingState,expired,uploadedDate`,
            { throwOnError: false },
          );
          return r.error ? null : r.data;
        },
        null,
      )
    : null;

  const latestBuilds = await section(
    "builds",
    () =>
      client.all(
        `/v1/builds?filter[app]=${appId}&sort=-uploadedDate&fields[builds]=version,processingState,expired,uploadedDate`,
        { limit: 10 },
      ),
    [],
  );

  const appInfoResult = await section(
    "appInfo",
    async () => {
      const r = await client.get(
        `/v1/apps/${appId}/appInfos?include=primaryCategory,secondaryCategory,ageRatingDeclaration`,
      );
      return { info: pickEditableAppInfo(r.data), included: r.included ?? [] };
    },
    { info: null, included: [] },
  );
  const appInfo = appInfoResult.info;

  const localizations = version
    ? await section(
        "localizations",
        async () => {
          const locs = await client.all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`, {
            limit: 50,
          });
          // Only the configured locales are expanded; fetching every field for
          // fifty locales the config says nothing about is not worth the round trips.
          const detailed = [];
          for (const loc of locs) {
            if (wanted.length && !wanted.includes(loc.attributes.locale)) {
              detailed.push({ ...loc, detailed: false });
              continue;
            }
            const full = await client.get(
              `/v1/appStoreVersionLocalizations/${loc.id}` +
                `?fields[appStoreVersionLocalizations]=locale,description,keywords,supportUrl,marketingUrl,promotionalText,whatsNew`,
            );
            detailed.push({ ...full.data, detailed: true });
          }
          return detailed;
        },
        [],
      )
    : [];

  const screenshotSets = await section(
    "screenshots",
    async () => {
      const out = [];
      for (const loc of localizations) {
        if (!loc.detailed) continue;
        const r = await client.get(
          `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots`,
        );
        for (const set of r.data ?? []) {
          const ids = new Set((set.relationships?.appScreenshots?.data ?? []).map((d) => d.id));
          const shots = (r.included ?? []).filter((x) => x.type === "appScreenshots" && ids.has(x.id));
          out.push({
            id: set.id,
            locale: loc.attributes.locale,
            displayType: set.attributes.screenshotDisplayType,
            screenshots: shots.map((s) => ({
              id: s.id,
              fileName: s.attributes.fileName,
              fileSize: s.attributes.fileSize,
              sourceFileChecksum: s.attributes.sourceFileChecksum,
              state: s.attributes.assetDeliveryState?.state,
            })),
          });
        }
      }
      return out;
    },
    [],
  );

  // The App Asset Library's view of the same thing (API 4.5.1). An app moved to
  // it may have no screenshot sets at all; reading only the sets would report
  // every screenshot as missing.
  const placements = await section(
    "placements",
    async () => {
      const out = [];
      for (const loc of localizations) {
        if (!loc.detailed) continue;
        const r = await client.get(
          `/v1/appStoreVersionLocalizations/${loc.id}/placements?filter[placementType]=APP_SCREENSHOT` +
            `&sort=placementGroupPosition&include=image` +
            `&fields[appAssetLibraryImages]=fileName,referenceName,state,imageAsset&limit=200`,
          { throwOnError: false },
        );
        if (r.error) return out; // no asset library for this app: not an error, just not there
        const images = new Map((r.included ?? []).map((x) => [x.id, x]));
        for (const p of r.data ?? []) {
          const image = images.get(p.relationships?.image?.data?.id);
          out.push({
            id: p.id,
            locale: loc.attributes.locale,
            placementGroup: p.attributes?.placementGroup,
            state: p.attributes?.state,
            fileName: image?.attributes?.fileName,
            assetState: image?.attributes?.state,
            width: image?.attributes?.imageAsset?.width,
            height: image?.attributes?.imageAsset?.height,
          });
        }
      }
      return out;
    },
    [],
  );

  const pricing = await section(
    "pricing",
    async () => {
      const r = await client.get(`/v1/appPriceSchedules/${appId}/manualPrices?limit=1`, { throwOnError: false });
      return { hasSchedule: !r.error && (r.data ?? []).length > 0 };
    },
    { hasSchedule: false },
  );

  const subscriptions = await section(
    "subscriptions",
    async () => {
      const r = await client.get(`/v1/apps/${appId}/subscriptionGroups?include=subscriptions&limit=50`);
      return (r.included ?? [])
        .filter((x) => x.type === "subscriptions")
        .map((s) => ({
          id: s.id,
          productId: s.attributes.productId,
          name: s.attributes.name,
          state: s.attributes.state,
        }));
    },
    [],
  );

  const inAppPurchases = await section(
    "inAppPurchases",
    async () => {
      const r = await client.get(
        `/v1/apps/${appId}/inAppPurchasesV2?fields[inAppPurchases]=productId,name,state,inAppPurchaseType&limit=200`,
        { throwOnError: false },
      );
      return (r.error ? [] : (r.data ?? [])).map((p) => ({
        id: p.id,
        productId: p.attributes?.productId,
        name: p.attributes?.name,
        state: p.attributes?.state,
        type: p.attributes?.inAppPurchaseType,
      }));
    },
    [],
  );

  const reviewDetail = version
    ? await section(
        "reviewDetail",
        async () => {
          const r = await client.get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`, {
            throwOnError: false,
          });
          return r.error ? null : r.data;
        },
        null,
      )
    : null;

  const submission = await section(
    "submission",
    async () => {
      // Items are included because their individual state is the only thing the
      // API says about *why* a submission is stuck — the Resolution Center text
      // itself is not exposed anywhere.
      const r = await client.get(
        `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS` +
          `&fields[reviewSubmissions]=state,submitted,items&include=items&limit=10`,
        { throwOnError: false },
      );
      if (r.error) return null;
      const open = (r.data ?? []).find((s) => s.attributes.state !== "COMPLETE");
      if (!open) return null;
      const itemIds = new Set((open.relationships?.items?.data ?? []).map((d) => d.id));
      return {
        ...open,
        items: (r.included ?? []).filter((x) => x.type === "reviewSubmissionItems" && itemIds.has(x.id)),
      };
    },
    null,
  );

  return {
    generatedAt: new Date().toISOString(),
    app,
    version,
    versions,
    build,
    latestBuilds,
    appInfo,
    appInfoIncluded: appInfoResult.included,
    localizations,
    screenshotSets,
    placements,
    pricing,
    subscriptions,
    inAppPurchases,
    reviewDetail,
    submission,
    locale: primary,
    locales: wanted,
    errors,
  };
}
