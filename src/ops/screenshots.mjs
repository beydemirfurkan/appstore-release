// Sync local PNGs to the version's screenshots — one group per device per locale.
//
// Two backends, one contract:
//   - asset-library  App Store Connect API 4.5.1's App Asset Library. Required
//                    for iPhone Duo; the default whenever the app has a library.
//   - legacy         the screenshot-set API Apple deprecated in 4.5.1.
// `screenshots.api` picks one; "auto" (the default) asks App Store Connect.
//
// Two things this operation must not do, both of which it used to:
//   - Delete every remote screenshot and re-upload the lot. A failure partway
//     through left the listing with fewer screenshots than it started with, and
//     it could never honestly report "already correct". Both backends diff.
//   - Handle exactly one display type, which meant an app supporting iPad could
//     not be submitted at all.

import { Status } from "../core/status.mjs";
import { AssetUploader } from "../asc/assets.mjs";
import { readPngHeader, fitsDisplayType, describeSizes } from "../asc/png.mjs";
import {
  AssetLibrary,
  groupsForImage,
  listScreenshotGroups,
  screenshotLimit,
  syncPlacements,
} from "../asc/asset-library.mjs";
import { syncScreenshotSet } from "../asc/screenshot-sets.mjs";
import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";
import { localeCodes } from "../core/locales.mjs";
import { resolveScreenshotSets } from "../core/screenshots.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "screenshots",
  title: "Screenshots",
  phase: "listing",
  needs: ["screenshots"],
  mutates: true,
  destructive: true,
  args: {
    prune: {
      type: "boolean",
      default: true,
      description: "remove remote screenshots that have no local counterpart",
    },
    displayType: {
      type: "string",
      description: "override config.screenshots.displayType (ignored when config.screenshots.sets is used)",
    },
    listGroups: {
      type: "boolean",
      default: false,
      description: "print the screenshot placement groups App Store Connect offers, and stop",
    },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ prune?: boolean, displayType?: string, listGroups?: boolean }} [args]
 */
export async function run(ctx, args = {}) {
  const { client, discovery, config, resolvePath } = ctx;
  const assetLibrary = new AssetLibrary(client, discovery.appId);

  if (args.listGroups) return listGroups(assetLibrary);

  const locales = localeCodes(config);
  const { sets: wanted, missing } = resolveScreenshotSets(config, resolvePath, locales, args);

  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = missing.map((m) =>
    finding({
      id: `screenshots.dir.missing.${m.key}.${m.locale}`,
      category: Category.ASSET,
      title: `No ${m.key} screenshots for ${m.locale}`,
      detail: `Looked in ${m.dir} and found no PNGs.`,
      fixOwner: FixOwner.EXTERNAL,
      fix: `Put exact-size PNGs there, or in a "${m.locale}" subdirectory of the configured directory.`,
      docs: "references/screenshots.md",
    }),
  );
  if (!wanted.length) {
    return { status: Status.ERROR, message: "no screenshots found for any configured locale", findings };
  }

  // Sets that name a display type are checked against its known sizes before
  // any request: a wrongly sized PNG must not cost a round trip, a reservation,
  // or a confusing 409. Placement-group-only sets are checked against Apple's
  // own catalog below, which needs the network by definition.
  const offline = wanted.filter((s) => s.displayType).flatMap((s) => prepareForSets(s).findings);
  if (offline.some(isFileProblem)) {
    findings.push(...offline);
    const count = offline.filter(isFileProblem).length;
    return { status: Status.ERROR, message: `${count} screenshot problem(s) to fix first`, findings };
  }

  const backend = await chooseBackend(config?.screenshots?.api ?? "auto", assetLibrary, wanted);
  if (backend.error) return { status: Status.ERROR, message: backend.error, findings };
  const ref = backend.name === "asset-library" ? await assetLibrary.refData() : null;
  if (backend.name === "asset-library" && !ref) {
    return {
      status: Status.ERROR,
      message: "App Store Connect did not return the asset library reference data (appAssetLibraryRefData)",
      findings,
    };
  }
  if (backend.name === "legacy") findings.push(legacyNotice(backend.why));

  // Validate every file locally before touching the network — a wrongly sized
  // PNG otherwise costs a round trip and returns a confusing 409.
  const prepared = [];
  for (const set of wanted) {
    const result = ref ? prepareForLibrary(set, ref) : prepareForSets(set);
    findings.push(...result.findings);
    if (result.local) prepared.push({ set, local: result.local, group: result.group });
  }
  const invalid = findings.filter(isFileProblem);
  if (invalid.length) {
    return { status: Status.ERROR, message: `${invalid.length} screenshot problem(s) to fix first`, findings };
  }

  const version = await discovery.editableVersion();
  const library = backend.name === "asset-library" ? await assetLibrary.library() : null;
  const summary = [];
  for (const { set, local, group } of prepared) {
    const loc = await discovery.versionLocalization(version.id, set.locale);
    const result =
      backend.name === "asset-library"
        ? await syncPlacements(ctx, {
            library: /** @type {{id: string}} */ (library),
            localizationId: loc.id,
            placementGroup: /** @type {string} */ (group),
            local,
            prune: Boolean(args.prune),
          })
        : await syncScreenshotSet(ctx, {
            localizationId: loc.id,
            displayType: set.displayType,
            local,
            prune: Boolean(args.prune),
          });
    const label = group ?? set.key;
    if (result.keptOrphans.length) {
      findings.push(
        finding({
          id: `screenshots.orphans.kept.${label}.${set.locale}`,
          severity: Severity.WARNING,
          category: Category.ASC_STATE,
          title: `${result.keptOrphans.length} remote ${label} screenshot(s) for ${set.locale} have no local counterpart`,
          detail: result.keptOrphans.join(", "),
          fixOwner: FixOwner.CLI,
          fix: "Re-run with prune enabled to remove them, or add the matching files locally.",
        }),
      );
    }
    summary.push({ group: label, locale: set.locale, total: local.length, ...result });
  }

  const uploaded = summary.reduce((n, s) => n + s.uploaded.length, 0);
  const reused = summary.reduce((n, s) => n + s.reused.length, 0);
  const deleted = summary.reduce((n, s) => n + s.deleted.length, 0);
  const unchanged = summary.reduce((n, s) => n + s.unchanged, 0);
  const details = { backend: backend.name, sets: summary, uploaded, reused, deleted, unchanged };
  const groups = new Set(summary.map((x) => x.group)).size;
  const where = `· ${groups} device size${groups === 1 ? "" : "s"}`;

  if (!summary.some((s) => s.changed)) {
    return { status: Status.OK, message: `${unchanged} screenshots already correct ${where}`, details, findings };
  }
  const parts = [`${uploaded} uploaded`];
  if (reused) parts.push(`${reused} reused from the library`);
  if (unchanged) parts.push(`${unchanged} unchanged`);
  if (deleted) parts.push(`${deleted} removed`);
  return { status: Status.CHANGED, message: `${parts.join(" · ")} ${where}`, details, findings };
}

/**
 * @param {string} requested
 * @param {AssetLibrary} assetLibrary
 * @param {import("../core/screenshots.mjs").ScreenshotSet[]} sets
 * @returns {Promise<{ name: "asset-library"|"legacy", why?: string, error?: string }>}
 */
async function chooseBackend(requested, assetLibrary, sets) {
  const needsLibrary = sets.filter((s) => !s.displayType).map((s) => s.key);
  if (requested === "legacy") {
    if (needsLibrary.length) {
      return {
        name: "legacy",
        error:
          `screenshots.api is "legacy", but ${[...new Set(needsLibrary)].join(", ")} name only a placement ` +
          "group — those exist only in the App Asset Library",
      };
    }
    return { name: "legacy", why: 'screenshots.api is "legacy"' };
  }
  if (await assetLibrary.library()) return { name: "asset-library" };
  if (requested === "asset-library" || needsLibrary.length) {
    return {
      name: "asset-library",
      error: "this app has no App Asset Library reachable with this API key (GET /v1/apps/{id}/assetLibrary failed)",
    };
  }
  return { name: "legacy", why: "This app has no App Asset Library reachable with this API key" };
}

/** @param {string|undefined} why */
function legacyNotice(why) {
  return finding({
    id: "screenshots.api.legacy",
    severity: Severity.INFO,
    category: Category.ASC_STATE,
    title: "Using the deprecated screenshot-set API",
    detail:
      `${why ?? "Falling back"}. Apple deprecated screenshot sets in App Store Connect API 4.5.1 in favour of the ` +
      "App Asset Library, which is also the only way to upload iPhone Duo screenshots.",
    fixOwner: FixOwner.CLI,
    fix: 'Remove screenshots.api (or set it to "auto") once the app has an asset library.',
  });
}

/**
 * Legacy path: sizes from the display-type table, no alpha.
 * @param {import("../core/screenshots.mjs").ScreenshotSet} set
 */
function prepareForSets(set) {
  const findings = [];
  const local = [];
  for (const file of set.files) {
    const path = `${set.dir}/${file}`;
    const header = readPngHeader(path);
    if (header && !fitsDisplayType(set.displayType, header.width, header.height)) {
      findings.push(
        fileFinding("dimensions", set, file, {
          title: `${file} is ${header.width}×${header.height}, not a ${set.displayType} size`,
          detail: `App Store Connect accepts ${describeSizes(set.displayType)} (or landscape) for ${set.displayType}.`,
          fix: `Re-render ${file} at one of those sizes.`,
        }),
      );
      continue;
    }
    if (header?.hasAlpha) {
      findings.push(alphaFinding(set, file));
      continue;
    }
    const { checksum, size } = AssetUploader.read(path);
    local.push({ file, path, checksum, size });
  }
  return { findings, local, group: null };
}

/**
 * Asset-library path: the placement group is the configured one, or the one
 * Apple's catalog says accepts these pixels — read from the first file, then
 * required of every other file in the set. Ambiguity is reported, never guessed.
 *
 * @param {import("../core/screenshots.mjs").ScreenshotSet} set
 * @param {import("../asc/asset-library.mjs").RefData} ref
 */
function prepareForLibrary(set, ref) {
  const findings = [];
  const local = [];
  let group = set.placementGroup;

  for (const file of set.files) {
    const path = `${set.dir}/${file}`;
    const header = readPngHeader(path);
    if (!header) {
      findings.push(
        fileFinding("unreadable", set, file, {
          title: `${file} is not a readable PNG`,
          detail: "Only PNG screenshots are read by this tool.",
          fix: `Export ${file} as PNG.`,
        }),
      );
      continue;
    }
    const candidates = groupsForImage(ref, header).filter((c) => !c.placementGroupId.startsWith("IMESSAGE_"));
    if (!group) {
      if (candidates.length === 1) {
        group = candidates[0].placementGroupId;
      } else {
        findings.push(
          fileFinding("group", set, file, {
            title: candidates.length
              ? `${file} (${header.width}×${header.height}) fits several placement groups`
              : `No screenshot placement group accepts ${header.width}×${header.height}`,
            detail: candidates.length
              ? `Candidates: ${candidates.map((c) => c.placementGroupId).join(", ")}.`
              : "App Store Connect's specification catalog has no screenshot size this matches.",
            fix: candidates.length
              ? "Name the one you mean in this set's placementGroup (`appstore-release screenshots --list-groups`)."
              : "Re-render at a size from `appstore-release screenshots --list-groups`.",
          }),
        );
        return { findings, local: null, group: null };
      }
    }
    const match = candidates.find((c) => c.placementGroupId === group);
    if (!match) {
      const sizes = listScreenshotGroups(ref).find((g) => g.placementGroupId === group)?.sizes ?? [];
      findings.push(
        fileFinding("dimensions", set, file, {
          title: `${file} is ${header.width}×${header.height}, which ${group} does not accept`,
          detail: sizes.length
            ? `${group} accepts ${sizes.join(", ")}.`
            : `${group} is not a screenshot placement group App Store Connect currently offers.`,
          fix: sizes.length ? `Re-render ${file} at one of those sizes.` : "Check `screenshots --list-groups`.",
        }),
      );
      continue;
    }
    if (header.hasAlpha && match.spec.alphaAllowed === false) {
      findings.push(alphaFinding(set, file));
      continue;
    }
    const { checksum, size } = AssetUploader.read(path);
    local.push({ file, path, checksum, size });
  }

  const limit = group ? screenshotLimit(ref, group) : 10;
  if (local.length > limit) {
    findings.push(
      fileFinding("count", set, `${local.length}-files`, {
        title: `${set.locale}: ${local.length} screenshots for ${group}, but Apple allows ${limit}`,
        detail: "Placements past the cap are refused.",
        fix: `Keep at most ${limit} files in ${set.dir}.`,
      }),
    );
  }
  return { findings, local, group };
}

/** A problem with a local file, which stops the upload before it starts. */
const isFileProblem = (/** @type {{ id: string }} */ f) =>
  f.id.startsWith("screenshots.file.") || f.id.startsWith("screenshots.dimensions.invalid.");

/**
 * @param {string} kind
 * @param {import("../core/screenshots.mjs").ScreenshotSet} set
 * @param {string} file
 * @param {{ title: string, detail: string, fix: string }} text
 */
function fileFinding(kind, set, file, text) {
  // Dimension problems keep the id the readiness report uses for the same thing.
  const prefix = kind === "dimensions" ? "screenshots.dimensions.invalid" : `screenshots.file.${kind}`;
  return finding({
    id: `${prefix}.${set.key}.${set.locale}.${file}`,
    category: Category.ASSET,
    fixOwner: FixOwner.EXTERNAL,
    docs: "references/screenshots.md",
    ...text,
  });
}

/** @param {import("../core/screenshots.mjs").ScreenshotSet} set @param {string} file */
function alphaFinding(set, file) {
  return fileFinding("alpha", set, file, {
    title: `${file} has an alpha channel`,
    detail: "App Store screenshots must be opaque; Apple rejects transparency.",
    fix: `Flatten ${file} onto an opaque background and export it without alpha.`,
  });
}

/** `screenshots --list-groups`: what Apple offers right now, straight from the catalog. */
async function listGroups(/** @type {AssetLibrary} */ assetLibrary) {
  const ref = await assetLibrary.refData();
  if (!ref) {
    return { status: Status.ERROR, message: "App Store Connect did not return the asset library reference data" };
  }
  const groups = listScreenshotGroups(ref);
  const lines = groups.map((g) => `${g.placementGroupId}  ${g.sizes.join(", ")}`);
  return {
    status: Status.OK,
    message: `${groups.length} screenshot placement groups:\n  ${lines.join("\n  ")}`,
    details: { groups },
  };
}
