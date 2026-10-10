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

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { Status } from "../core/status.mjs";
import { finding, Category, FixOwner } from "../core/findings.mjs";
import { AssetLibrary, groupsForImage, groupsForVideo, syncPlacements } from "../asc/asset-library.mjs";
import { readPngHeader } from "../asc/png.mjs";
import { readVideoHeader } from "../asc/video.mjs";

/** Page version states that can still be edited. */
export const EDITABLE_PAGE_STATES = ["PREPARE_FOR_SUBMISSION", "REJECTED"];

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

  // Every file is checked before any request.
  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = [];
  /** @type {Map<string, Array<{ media: "image"|"video", group: string, local: any[] }>>} */
  const media = new Map();
  for (const page of pages) {
    for (const [locale, l] of Object.entries(page.locales ?? {})) {
      const sets = [];
      for (const [kind, dir] of /** @type {const} */ ([
        ["image", l.screenshots],
        ["video", l.previews],
      ])) {
        if (!dir) continue;
        const res = groupFiles(
          resolvePath(dir, `customProductPages.${page.name}.${locale}`),
          kind,
          /** @type {any} */ (ref),
        );
        findings.push(...res.findings.map((f) => ({ ...f, detail: `${page.name} · ${locale}: ${f.detail}` })));
        sets.push(...res.sets.map((s) => ({ media: kind, ...s })));
      }
      media.set(`${page.name}\u0000${locale}`, sets);
    }
  }
  if (findings.length)
    return { status: Status.ERROR, message: `${findings.length} custom product page file problem(s)`, findings };

  const existing = await client.all(`/v1/apps/${discovery.appId}/appCustomProductPages`, { limit: 200 });
  const changes = [];
  for (const page of pages) {
    const label = `"${page.name}"`;
    let remote = existing.find((p) => p.attributes?.name === page.name);
    if (!remote) {
      remote = (
        await client.post(`/v1/appCustomProductPages`, {
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
        })
      ).data;
      changes.push(`${label} created`);
    }
    const planned = String(remote.id).startsWith("dry:");

    if (page.visible !== undefined && !planned && remote.attributes?.visible !== page.visible) {
      await client.patch(`/v1/appCustomProductPages/${remote.id}`, {
        data: { type: "appCustomProductPages", id: remote.id, attributes: { visible: page.visible } },
      });
      changes.push(`${label} ${page.visible ? "visible" : "hidden"}`);
    }

    const versions = planned
      ? []
      : await client.all(`/v1/appCustomProductPages/${remote.id}/appCustomProductPageVersions`, { limit: 50 });
    let version = versions.find((v) => EDITABLE_PAGE_STATES.includes(v.attributes?.state));
    const live = versions.find((v) => v.attributes?.state === "APPROVED");

    if (!version) {
      // Only an approved version: a new one only if the config differs from it.
      const differs = !live || (await pageDiffers(ctx, page, live, media, /** @type {any} */ (library)));
      if (!differs) continue;
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
    } else if (page.deepLink !== undefined && (version.attributes?.deepLink ?? "") !== page.deepLink) {
      await client.patch(`/v1/appCustomProductPageVersions/${version.id}`, {
        data: { type: "appCustomProductPageVersions", id: version.id, attributes: { deepLink: page.deepLink } },
      });
      changes.push(`${label} deep link`);
    }

    // Localizations: a new version may or may not start with the previous one's,
    // so they are read back rather than assumed.
    const versionPlanned = String(version.id).startsWith("dry:");
    const locs = versionPlanned
      ? []
      : await client.all(`/v1/appCustomProductPageVersions/${version.id}/appCustomProductPageLocalizations`, {
          limit: 50,
        });
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
      for (const set of media.get(`${page.name}\u0000${locale}`) ?? []) {
        const res = await syncPlacements(ctx, {
          library: /** @type {any} */ (library),
          parent: { type: "appCustomProductPageLocalizations", id: loc.id },
          media: set.media,
          placementGroup: set.group,
          local: set.local,
          prune: true,
        });
        if (res.changed) changes.push(`${label} ${locale} ${set.media === "video" ? "previews" : "screenshots"}`);
      }
    }
  }

  return changes.length
    ? { status: Status.CHANGED, message: changes.join(" · "), findings }
    : { status: Status.OK, message: `${pages.length} page(s) match the config`, findings };
}

/**
 * Whether an approved page version differs from the config: deep link, locales,
 * promotional text, or the media placed on each locale.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {PageConfig} page
 * @param {any} live
 * @param {Map<string, any[]>} media
 * @param {{ id: string }} library
 */
async function pageDiffers(ctx, page, live, media, library) {
  if (page.deepLink !== undefined && (live.attributes?.deepLink ?? "") !== page.deepLink) return true;
  const locs = await ctx.client.all(`/v1/appCustomProductPageVersions/${live.id}/appCustomProductPageLocalizations`, {
    limit: 50,
  });
  for (const [locale, l] of Object.entries(page.locales ?? {})) {
    const loc = locs.find((x) => x.attributes?.locale === locale);
    if (!loc) return true;
    if (l.promotionalText !== undefined && (loc.attributes?.promotionalText ?? "") !== l.promotionalText) return true;
    for (const set of media.get(`${page.name}\u0000${locale}`) ?? []) {
      const res = await syncPlacements(ctx, {
        library,
        parent: { type: "appCustomProductPageLocalizations", id: loc.id },
        media: set.media,
        placementGroup: set.group,
        local: set.local,
        prune: true,
        checkOnly: true,
      });
      if (res.changed) return true;
    }
  }
  return false;
}

/**
 * The files of one folder, grouped by placement group (screenshots by PNG size,
 * previews by video size), with any file that fits no group reported.
 *
 * @param {string} dir
 * @param {"image"|"video"} media
 * @param {import("../asc/asset-library.mjs").RefData} ref
 */
function groupFiles(dir, media, ref) {
  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = [];
  /** @type {Map<string, Array<{ file: string, path: string, size: number }>>} */
  const byGroup = new Map();
  const exts = media === "image" ? [".png"] : [".mov", ".mp4", ".m4v"];
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
        .sort()
    : [];
  if (!files.length) {
    findings.push(problem(`No ${media === "image" ? "PNG screenshots" : "previews"} in ${dir}`, dir));
  }
  for (const file of files) {
    const path = join(dir, file);
    const header = media === "image" ? readPngHeader(path) : readVideoHeader(path);
    const candidates = header
      ? (media === "image" ? groupsForImage(ref, header) : groupsForVideo(ref, header)).filter(
          (c) => !c.placementGroupId.startsWith("IMESSAGE_"),
        )
      : [];
    if (candidates.length !== 1) {
      findings.push(
        problem(
          header
            ? `${file} (${header.width}×${header.height}) fits ${candidates.length ? "several groups" : "no device size"}`
            : `${file} cannot be read`,
          file,
        ),
      );
      continue;
    }
    const list = byGroup.get(candidates[0].placementGroupId) ?? [];
    list.push({ file, path, size: statSync(path).size });
    byGroup.set(candidates[0].placementGroupId, list);
  }
  return { findings, sets: [...byGroup].map(([group, local]) => ({ group, local })) };
}

/** @param {string} title @param {string} what */
function problem(title, what) {
  return finding({
    id: `custom-product-pages.file.${what}`,
    category: Category.ASSET,
    title,
    detail: what,
    fixOwner: FixOwner.EXTERNAL,
    fix: "Use exact App Store sizes: `appstore-release screenshots --list-groups`.",
  });
}
