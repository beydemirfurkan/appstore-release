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

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { Status } from "../core/status.mjs";
import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";
import { localeCodes } from "../core/locales.mjs";
import {
  AssetLibrary,
  durationSeconds,
  groupsForVideo,
  placementLimit,
  previewSizes,
  syncPlacements,
} from "../asc/asset-library.mjs";
import { readVideoHeader } from "../asc/video.mjs";

const VIDEO_EXTENSIONS = [".mov", ".mp4", ".m4v"];

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

  // Every locale's files, grouped by placement group, checked locally.
  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = [];
  /** @type {Array<{ locale: string, group: string, local: Array<{ file: string, path: string, size: number }> }>} */
  const plan = [];
  const base = resolvePath(p.dir, "previews.dir");
  for (const locale of localeCodes(config)) {
    const own = join(base, locale);
    const dir = existsSync(own) && statSync(own).isDirectory() ? own : base;
    const files = listVideos(dir);
    if (!files.length) continue;
    /** @type {Map<string, Array<{ file: string, path: string, size: number }>>} */
    const byGroup = new Map();
    for (const file of files) {
      const path = join(dir, file);
      const header = readVideoHeader(path);
      if (!header) {
        findings.push(
          fileProblem(
            locale,
            file,
            `${file} is not a readable MP4 or QuickTime video`,
            "Export it as H.264 or HEVC in .mov or .mp4.",
          ),
        );
        continue;
      }
      const candidates = groupsForVideo(ref, header).filter((c) => !c.placementGroupId.startsWith("IMESSAGE_"));
      const chosen = p.placementGroup
        ? candidates.find((c) => c.placementGroupId === p.placementGroup)
        : candidates.length === 1
          ? candidates[0]
          : null;
      if (!chosen) {
        findings.push(
          fileProblem(
            locale,
            file,
            candidates.length
              ? `${file} (${header.width}×${header.height}) fits several preview groups: ${candidates.map((c) => c.placementGroupId).join(", ")}`
              : `No app preview size is ${header.width}×${header.height}`,
            candidates.length
              ? "Name the one you mean in previews.placementGroup."
              : `Re-render at one of: ${previewSizes(ref).join(", ")}.`,
          ),
        );
        continue;
      }
      const min = durationSeconds(chosen.spec.duration?.min);
      const max = durationSeconds(chosen.spec.duration?.max);
      const secs = Math.round(header.durationSeconds * 10) / 10;
      if ((min != null && header.durationSeconds < min) || (max != null && header.durationSeconds > max)) {
        findings.push(
          fileProblem(
            locale,
            file,
            `${file} is ${secs} seconds; previews run ${min ?? "?"}–${max ?? "?"} seconds`,
            "Trim or extend it.",
          ),
        );
        continue;
      }
      const list = byGroup.get(chosen.placementGroupId) ?? [];
      list.push({ file, path, size: statSync(path).size });
      byGroup.set(chosen.placementGroupId, list);
    }
    for (const [group, local] of byGroup) {
      const limit = placementLimit(ref, group, "APP_PREVIEW", 3);
      if (local.length > limit) {
        findings.push(
          fileProblem(
            locale,
            `${local.length}-files`,
            `${locale}: ${local.length} previews for ${group}, but Apple allows ${limit}`,
            `Keep at most ${limit}.`,
          ),
        );
        continue;
      }
      plan.push({ locale, group, local });
    }
  }
  const problems = findings.filter((f) => f.severity === Severity.BLOCKER);
  if (problems.length)
    return { status: Status.ERROR, message: `${problems.length} preview problem(s) to fix first`, findings };
  if (!plan.length)
    return { status: Status.ERROR, message: `no previews (${VIDEO_EXTENSIONS.join(", ")}) in ${p.dir}`, findings };

  const version = await discovery.editableVersion();
  let uploaded = 0;
  let unchanged = 0;
  let removed = 0;
  let changed = false;
  for (const { locale, group, local } of plan) {
    const loc = await discovery.versionLocalization(version.id, locale);
    const result = await syncPlacements(ctx, {
      library: /** @type {{ id: string }} */ (library),
      parent: { type: "appStoreVersionLocalizations", id: loc.id },
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
  const groups = new Set(plan.map((x) => x.group)).size;
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

/** Video files in a folder, in name order (that is the order they are shown in). @param {string} dir */
function listVideos(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => VIDEO_EXTENSIONS.some((e) => f.toLowerCase().endsWith(e)))
    .sort();
}

/** @param {string} locale @param {string} file @param {string} title @param {string} fix */
function fileProblem(locale, file, title, fix) {
  return finding({
    id: `previews.file.${locale}.${file}`,
    category: Category.ASSET,
    title,
    detail: `In the ${locale} previews.`,
    fixOwner: FixOwner.EXTERNAL,
    fix,
  });
}
