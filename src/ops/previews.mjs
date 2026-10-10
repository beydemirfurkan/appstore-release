// App previews: the videos at the top of a product page, through the App Asset
// Library (videos placed with APP_PREVIEW) — the same reconciliation as
// screenshots, so a re-run uploads nothing that is already there.
//
// Every file is checked before anything is sent: its pixel size against Apple's
// video specifications (read at runtime from appAssetLibraryRefData, which also
// decides the placement group), and its length against the spec's duration.
// A preview is a few hundred megabytes; a wrong one must not cost an upload.
//
// The config names a folder; files are grouped by size into device groups, and
// a locale subfolder (`previews/tr/`) replaces the folder for that locale.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { Status } from "../core/status.mjs";
import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";
import { localeCodes } from "../core/locales.mjs";
import { AssetLibrary, pruneOtherGroups, syncPlacements } from "../asc/asset-library.mjs";
import { planMedia } from "../asc/media-check.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "previews",
  title: "App previews",
  phase: "listing",
  needs: [],
  mutates: true,
  destructive: true,
  args: {
    prune: {
      type: "boolean",
      default: false,
      description: "remove placed previews with no local counterpart",
    },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ prune?: boolean }} [args]
 */
export async function run(ctx, args = {}) {
  const { client, discovery, config, resolvePath } = ctx;
  const p = config?.previews;
  if (!p?.dir) return { status: Status.SKIPPED, message: "none configured" };

  const assetLibrary = new AssetLibrary(client, discovery.appId);
  const library = await assetLibrary.library();
  if (!library) {
    return {
      status: Status.ERROR,
      message: "this app has no App Asset Library, which previews are uploaded through here",
      findings: [
        finding({
          id: "previews.no-asset-library",
          category: Category.ASC_STATE,
          title: "No App Asset Library for this app",
          detail: "Previews are placed through the App Asset Library (API 4.5.1); App Store Connect returned none.",
          fixOwner: FixOwner.UI,
          fix: "Upload previews in App Store Connect, on the version page.",
        }),
      ],
    };
  }
  const ref = await assetLibrary.refData();
  if (!ref) {
    return { status: Status.ERROR, message: "App Store Connect did not return the asset library reference data" };
  }

  // Every locale's files, grouped by device group and checked locally. A locale
  // subfolder replaces the folder — an empty one means "no previews in this
  // locale", which --prune then makes true.
  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = [];
  /** @type {Array<{ locale: string, sets: Array<{ group: string, local: Array<{ file: string, path: string, size: number }> }> }>} */
  const plan = [];
  const base = resolvePath(p.dir, "previews.dir");
  for (const locale of localeCodes(config)) {
    const own = join(base, locale);
    const dir = existsSync(own) && statSync(own).isDirectory() ? own : base;
    const res = planMedia({
      dir,
      media: "video",
      ref,
      placementGroup: p.placementGroup,
      idPrefix: `previews.${locale}`,
      where: `${locale} previews, in ${dir}`,
    });
    findings.push(...res.findings);
    if (res.sets.length || (args.prune && dir === own)) plan.push({ locale, sets: res.sets });
  }
  const problems = findings.filter((f) => f.severity === Severity.BLOCKER);
  if (problems.length)
    return { status: Status.ERROR, message: `${problems.length} preview problem(s) to fix first`, findings };
  if (!plan.length) return { status: Status.ERROR, message: `no previews (.mov, .mp4, .m4v) in ${p.dir}`, findings };

  const version = await discovery.editableVersion();
  let uploaded = 0;
  let unchanged = 0;
  let removed = 0;
  let changed = false;
  for (const { locale, sets } of plan) {
    const loc = await discovery.versionLocalization(version.id, locale);
    const parent = { type: /** @type {const} */ ("appStoreVersionLocalizations"), id: loc.id };
    for (const { group, local } of sets) {
      const result = await syncPlacements(ctx, {
        library: /** @type {{ id: string }} */ (library),
        parent,
        media: "video",
        previewFrameTimeCode: p.posterFrame,
        placementGroup: group,
        local,
        prune: Boolean(args.prune),
      });
      uploaded += result.uploaded.length;
      unchanged += result.unchanged;
      removed += result.deleted.length;
      changed ||= result.changed;
      if (result.keptOrphans.length) {
        findings.push(
          finding({
            id: `previews.orphans.kept.${group}.${locale}`,
            severity: Severity.WARNING,
            category: Category.ASC_STATE,
            title: `${result.keptOrphans.length} placed preview(s) for ${group} · ${locale} have no local file`,
            detail: result.keptOrphans.join(", "),
            fixOwner: FixOwner.CLI,
            fix: "Run previews --prune to remove them, or add the files locally.",
          }),
        );
      }
    }
    // Device groups with no file left at all are only visited here.
    if (args.prune) {
      const stray = await pruneOtherGroups(ctx, { parent, media: "video", keep: sets.map((x) => x.group) });
      removed += stray;
      changed ||= stray > 0;
    }
  }
  const groups = new Set(plan.flatMap((x) => x.sets.map((y) => y.group))).size;
  const where = `· ${groups} device size${groups === 1 ? "" : "s"}`;
  if (!changed) return { status: Status.OK, message: `${unchanged} previews already correct ${where}`, findings };
  const parts = [`${uploaded} uploaded`];
  if (unchanged) parts.push(`${unchanged} unchanged`);
  if (removed) parts.push(`${removed} removed`);
  return {
    status: Status.CHANGED,
    message: `${parts.join(" · ")} ${where} — Apple processes videos; check again in a few minutes`,
    findings,
  };
}
