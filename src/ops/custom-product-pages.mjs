// Custom product pages: alternative product pages, each with its own URL, for an
// ad campaign, a season or an audience — their own promotional text,
// screenshots and previews, and an optional deep link into the app.
//
// Apple's model (API 4.5.1): page → versions → localizations; screenshots and
// previews are App Asset Library placements on a localization. A version that
// has been approved cannot change, so a new version is created only when the
// config differs from what is live — text, deep link, locales or media — and the
// approved one keeps serving until the new one is approved. `submit` sends an
// editable page version in the same review submission as the app.

import { Status } from "../core/status.mjs";
import { AssetLibrary, pruneOtherGroups, syncPlacements } from "../asc/asset-library.mjs";
import { planMedia } from "../asc/media-check.mjs";

/** Page version states that can still be edited. */
export const EDITABLE_PAGE_STATES = ["PREPARE_FOR_SUBMISSION", "REJECTED"];
/** With Apple: nothing can change, and no new version can be started. */
const REVIEW_PAGE_STATES = ["READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW", "ACCEPTED"];

/** The newest of some versions, by their version number. @param {any[]} versions */
const newest = (versions) =>
  [...versions].sort((a, b) => Number(b.attributes?.version ?? 0) - Number(a.attributes?.version ?? 0))[0];

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "custom-product-pages",
  title: "Custom product pages",
  phase: "listing",
  needs: [],
  mutates: true,
};

/**
 * @typedef {Object} PageConfig
 * @property {string} name
 * @property {string} [deepLink]
 * @property {boolean} [visible]
 * @property {Record<string, { promotionalText?: string, screenshots?: string, previews?: string }>} locales
 */

/** @param {any} config @returns {PageConfig[]} */
export const pageConfigs = (config) => (Array.isArray(config?.customProductPages) ? config.customProductPages : []);

/** @param {import("../core/context.mjs").Context} ctx */
export async function run(ctx) {
  const { client, discovery, config, resolvePath } = ctx;
  const pages = pageConfigs(config);
  if (!pages.length) return { status: Status.SKIPPED, message: "none configured" };

  const assetLibrary = new AssetLibrary(client, discovery.appId);
  const needsMedia = pages.some((p) => Object.values(p.locales ?? {}).some((l) => l.screenshots || l.previews));
  const library = needsMedia ? await assetLibrary.library() : null;
  const ref = needsMedia ? await assetLibrary.refData() : null;
  if (needsMedia && (!library || !ref)) {
    return {
      status: Status.ERROR,
      message: "custom product page media goes through the App Asset Library, which App Store Connect did not return",
    };
  }

  // Every file is checked before any request, with the checks the product page
  // gets and the custom product page limits.
  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = [];
  /** @type {Map<string, MediaPlan>} */
  const media = new Map();
  for (const page of pages) {
    for (const [locale, l] of Object.entries(page.locales ?? {})) {
      /** @type {MediaPlan} */
      const plan = [];
      for (const [kind, dir] of /** @type {const} */ ([
        ["image", l.screenshots],
        ["video", l.previews],
      ])) {
        if (!dir) continue;
        const res = planMedia({
          dir: resolvePath(dir, `customProductPages.${page.name}.${locale}`),
          media: kind,
          ref: /** @type {any} */ (ref),
          feature: "CUSTOM_PRODUCT_PAGES",
          idPrefix: `custom-product-pages.${page.name}.${locale}.${kind}`,
          where: `Custom product page "${page.name}", ${locale}`,
        });
        findings.push(...res.findings);
        plan.push({ media: kind, sets: res.sets });
      }
      media.set(`${page.name}\u0000${locale}`, plan);
    }
  }
  if (findings.length) {
    return { status: Status.ERROR, message: `${findings.length} custom product page file problem(s)`, findings };
  }

  const existing = await client.all(`/v1/apps/${discovery.appId}/appCustomProductPages`, { limit: 200 });
  const changes = [];
  const notes = [];
  for (const page of pages) {
    const label = `"${page.name}"`;
    let remote = existing.find((p) => p.attributes?.name === page.name);
    /** @type {any} */
    let version = null;
    if (!remote) {
      const created = await client.post(`/v1/appCustomProductPages`, {
        data: {
          type: "appCustomProductPages",
          attributes: { name: page.name },
          relationships: {
            app: { data: { type: "apps", id: discovery.appId } },
            appCustomProductPageVersions: { data: [{ type: "appCustomProductPageVersions", id: "${version}" }] },
          },
        },
        included: [
          {
            type: "appCustomProductPageVersions",
            id: "${version}",
            attributes: page.deepLink ? { deepLink: page.deepLink } : {},
          },
        ],
      });
      remote = created.data;
      changes.push(`${label} created`);
      // Under --dry-run the inline version only exists on paper; stand in for it.
      if (String(remote.id).startsWith("dry:"))
        version = { id: `dry:appCustomProductPageVersions:${page.name}`, attributes: {} };
    }

    const versions =
      version || String(remote.id).startsWith("dry:")
        ? []
        : await client.all(`/v1/appCustomProductPages/${remote.id}/appCustomProductPageVersions`, { limit: 50 });
    version ??= newest(versions.filter((v) => EDITABLE_PAGE_STATES.includes(v.attributes?.state))) ?? null;
    const inReview = versions.find((v) => REVIEW_PAGE_STATES.includes(v.attributes?.state));
    const live = newest(versions.filter((v) => v.attributes?.state === "APPROVED"));

    if (!version && inReview) {
      notes.push(`${label} is in review — nothing changes until Apple answers`);
    } else if (!version) {
      // Only an approved version: a new one only if the config differs from it.
      const differs = !live || (await pageDiffers(ctx, page, live, media));
      if (differs) {
        version = (
          await client.post(`/v1/appCustomProductPageVersions`, {
            data: {
              type: "appCustomProductPageVersions",
              attributes: page.deepLink ? { deepLink: page.deepLink } : {},
              relationships: { appCustomProductPage: { data: { type: "appCustomProductPages", id: remote.id } } },
            },
          })
        ).data;
        changes.push(`${label} new version`);
      }
    } else if (page.deepLink !== undefined && (version.attributes?.deepLink ?? "") !== page.deepLink) {
      await client.patch(`/v1/appCustomProductPageVersions/${version.id}`, {
        data: { type: "appCustomProductPageVersions", id: version.id, attributes: { deepLink: page.deepLink } },
      });
      changes.push(`${label} deep link`);
    }

    if (version) await completeVersion(ctx, page, version, media, /** @type {any} */ (library), changes);

    // A page's URL can only go live once a version of it is approved.
    if (page.visible !== undefined && remote.attributes?.visible !== page.visible) {
      if (live) {
        await client.patch(`/v1/appCustomProductPages/${remote.id}`, {
          data: { type: "appCustomProductPages", id: remote.id, attributes: { visible: page.visible } },
        });
        changes.push(`${label} ${page.visible ? "visible" : "hidden"}`);
      } else if (page.visible) {
        notes.push(`${label} becomes visible once a version is approved — run again then`);
      }
    }
  }

  const tail = notes.length ? ` (${notes.join("; ")})` : "";
  return changes.length
    ? { status: Status.CHANGED, message: changes.join(" · ") + tail, findings }
    : { status: Status.OK, message: `${pages.length} page(s) match the config${tail}`, findings };
}

/** @typedef {Array<{ media: "image"|"video", sets: Array<{ group: string, local: Array<{ file: string, path: string, size: number }> }> }>} MediaPlan */

/**
 * Bring an editable page version in line with the config: localizations (a
 * removed locale goes), promotional text, and each locale's media — every
 * configured kind reconciled per device group, and groups with no file left
 * removed.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {PageConfig} page
 * @param {any} version
 * @param {Map<string, MediaPlan>} media
 * @param {{ id: string }} library
 * @param {string[]} changes
 */
async function completeVersion(ctx, page, version, media, library, changes) {
  const { client } = ctx;
  const label = `"${page.name}"`;
  // A new version may or may not start with the previous one's localizations,
  // so they are read back rather than assumed.
  const locs = String(version.id).startsWith("dry:")
    ? []
    : await client.all(`/v1/appCustomProductPageVersions/${version.id}/appCustomProductPageLocalizations`, {
        limit: 50,
      });
  const wanted = Object.keys(page.locales ?? {});
  for (const gone of locs.filter((x) => !wanted.includes(x.attributes?.locale))) {
    await client.delete(`/v1/appCustomProductPageLocalizations/${gone.id}`);
    changes.push(`${label} ${gone.attributes?.locale} removed`);
  }
  for (const [locale, l] of Object.entries(page.locales ?? {})) {
    let loc = locs.find((x) => x.attributes?.locale === locale);
    if (!loc) {
      loc = (
        await client.post(`/v1/appCustomProductPageLocalizations`, {
          data: {
            type: "appCustomProductPageLocalizations",
            attributes: { locale, ...(l.promotionalText ? { promotionalText: l.promotionalText } : {}) },
            relationships: {
              appCustomProductPageVersion: { data: { type: "appCustomProductPageVersions", id: version.id } },
            },
          },
        })
      ).data;
      changes.push(`${label} ${locale}`);
    } else if (l.promotionalText !== undefined && (loc.attributes?.promotionalText ?? "") !== l.promotionalText) {
      await client.patch(`/v1/appCustomProductPageLocalizations/${loc.id}`, {
        data: {
          type: "appCustomProductPageLocalizations",
          id: loc.id,
          attributes: { promotionalText: l.promotionalText },
        },
      });
      changes.push(`${label} ${locale} text`);
    }
    const parent = { type: /** @type {const} */ ("appCustomProductPageLocalizations"), id: loc.id };
    for (const kind of media.get(`${page.name}\u0000${locale}`) ?? []) {
      let touched = false;
      for (const set of kind.sets) {
        const res = await syncPlacements(ctx, {
          library,
          parent,
          media: kind.media,
          placementGroup: set.group,
          local: set.local,
          prune: true,
        });
        touched ||= res.changed;
      }
      const stray = await pruneOtherGroups(ctx, { parent, media: kind.media, keep: kind.sets.map((x) => x.group) });
      if (touched || stray) changes.push(`${label} ${locale} ${kind.media === "video" ? "previews" : "screenshots"}`);
    }
  }
}

/**
 * Whether an approved page version differs from the config: deep link, the set
 * of locales, promotional text, or the media placed on each locale.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {PageConfig} page
 * @param {any} live
 * @param {Map<string, MediaPlan>} media
 */
async function pageDiffers(ctx, page, live, media) {
  if (page.deepLink !== undefined && (live.attributes?.deepLink ?? "") !== page.deepLink) return true;
  const locs = await ctx.client.all(`/v1/appCustomProductPageVersions/${live.id}/appCustomProductPageLocalizations`, {
    limit: 50,
  });
  const wanted = Object.keys(page.locales ?? {});
  if (locs.some((x) => !wanted.includes(x.attributes?.locale))) return true;
  const library = { id: "check-only" };
  for (const [locale, l] of Object.entries(page.locales ?? {})) {
    const loc = locs.find((x) => x.attributes?.locale === locale);
    if (!loc) return true;
    if (l.promotionalText !== undefined && (loc.attributes?.promotionalText ?? "") !== l.promotionalText) return true;
    const parent = { type: /** @type {const} */ ("appCustomProductPageLocalizations"), id: loc.id };
    for (const kind of media.get(`${page.name}\u0000${locale}`) ?? []) {
      for (const set of kind.sets) {
        const res = await syncPlacements(ctx, {
          library,
          parent,
          media: kind.media,
          placementGroup: set.group,
          local: set.local,
          prune: true,
          checkOnly: true,
        });
        if (res.changed) return true;
      }
      const stray = await pruneOtherGroups(ctx, {
        parent,
        media: kind.media,
        keep: kind.sets.map((x) => x.group),
        checkOnly: true,
      });
      if (stray) return true;
    }
  }
  return false;
}
