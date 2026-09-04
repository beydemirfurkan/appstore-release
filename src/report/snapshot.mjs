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
 * @property {any[]} screenshotSets
 * @property {any} pricing
 * @property {any[]} subscriptions
 * @property {any} reviewDetail
 * @property {any} submission
 * @property {string|null} locale       the primary locale the report is about
 * @property {string[]} locales         every locale the config describes
 * @property {string[]} errors          sections we could not read, by name
 */

import { localeCodes } from "../core/locales.mjs";

/** Editable states, i.e. the version we are allowed to prepare. */
export const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
  "WAITING_FOR_REVIEW",
  "DEVELOPER_REMOVED_FROM_SALE",
]);

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
        `/v1/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString,appStoreState,platform,copyright`,
        { limit: 50 },
      ),
    [],
  );
  // Deliberately null rather than "whatever came back first": targeting a live
  // version because no editable one exists is worse than reporting that fact.
  const version = versions.find((v) => EDITABLE_STATES.has(v.attributes.appStoreState)) ?? null;

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
      const info =
        r.data.find((i) => ["PREPARE_FOR_SUBMISSION", "READY_FOR_DISTRIBUTION"].includes(i.attributes.appStoreState)) ??
        r.data[0] ??
        null;
      return { info, included: r.included ?? [] };
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
      const r = await client.get(
        `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&fields[reviewSubmissions]=state,submitted&limit=10`,
        { throwOnError: false },
      );
      if (r.error) return null;
      return (r.data ?? []).find((s) => s.attributes.state !== "COMPLETE") ?? null;
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
    pricing,
    subscriptions,
    reviewDetail,
    submission,
    locale: primary,
    locales: wanted,
    errors,
  };
}
