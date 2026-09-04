// Sync local PNGs to the version's screenshot sets — one per display type per locale.
//
// Two things this operation must not do, both of which it used to:
//   - Delete every remote screenshot and re-upload the lot. A failure partway
//     through left the listing with fewer screenshots than it started with, and
//     it could never honestly report "already correct". App Store Connect stores
//     the md5 it was committed with, so a diff is cheap and exact.
//   - Handle exactly one display type, which meant an app supporting iPad could
//     not be submitted at all.

import { Status } from "../core/status.mjs";
import { AssetUploader } from "../asc/assets.mjs";
import { readPngHeader, DISPLAY_TYPE_SIZES } from "../asc/png.mjs";
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
      description: "delete remote screenshots that have no local counterpart",
    },
    displayType: {
      type: "string",
      description: "override config.screenshots.displayType (ignored when config.screenshots.sets is used)",
    },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ prune?: boolean, displayType?: string }} [args]
 */
export async function run(ctx, args = {}) {
  const { client, discovery, config, resolvePath } = ctx;
  const locales = localeCodes(config);
  const { sets: wanted, missing } = resolveScreenshotSets(config, resolvePath, locales, args);

  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = missing.map((m) =>
    finding({
      id: `screenshots.dir.missing.${m.displayType}.${m.locale}`,
      category: Category.ASSET,
      title: `No ${m.displayType} screenshots for ${m.locale}`,
      detail: `Looked in ${m.dir} and found no PNGs.`,
      fixOwner: FixOwner.EXTERNAL,
      fix: `Put exact-size PNGs there, or in a "${m.locale}" subdirectory of the configured directory.`,
      docs: "references/screenshots.md",
    }),
  );

  if (!wanted.length) {
    return { status: Status.ERROR, message: "no screenshots found for any configured locale", findings };
  }

  // Validate every file locally before touching the network — a wrongly sized
  // PNG otherwise costs a round trip and returns a confusing 409.
  /** @type {Array<{set: import("../core/screenshots.mjs").ScreenshotSet, local: any[]}>} */
  const prepared = [];
  for (const set of wanted) {
    const expected = DISPLAY_TYPE_SIZES[set.displayType];
    const local = [];
    for (const file of set.files) {
      const path = `${set.dir}/${file}`;
      const header = readPngHeader(path);
      if (expected && header && (header.width !== expected.width || header.height !== expected.height)) {
        findings.push(
          finding({
            id: `screenshots.dimensions.invalid.${set.displayType}.${file}`,
            category: Category.ASSET,
            title: `${file} is ${header.width}×${header.height}, not ${expected.width}×${expected.height}`,
            detail: `App Store Connect accepts only the exact size for ${set.displayType}.`,
            fixOwner: FixOwner.EXTERNAL,
            fix: `Re-render ${file} at ${expected.width}×${expected.height}.`,
          }),
        );
        continue;
      }
      const { checksum, size } = AssetUploader.read(path);
      local.push({ file, path, checksum, size });
    }
    prepared.push({ set, local });
  }

  if (findings.some((f) => f.id.startsWith("screenshots.dimensions.invalid"))) {
    const count = findings.filter((f) => f.id.startsWith("screenshots.dimensions.invalid")).length;
    return { status: Status.ERROR, message: `${count} screenshot(s) are the wrong size`, findings };
  }

  const version = await discovery.editableVersion();
  const summary = [];
  let anyChange = false;

  for (const { set, local } of prepared) {
    const result = await syncSet(ctx, { version, set, local, prune: args.prune, findings });
    summary.push(result);
    anyChange ||= result.changed;
  }

  const uploaded = summary.reduce((n, s) => n + s.uploaded.length, 0);
  const deleted = summary.reduce((n, s) => n + s.deleted.length, 0);
  const unchanged = summary.reduce((n, s) => n + s.unchanged, 0);
  const details = { sets: summary, uploaded, deleted, unchanged };

  if (!anyChange) {
    return {
      status: Status.OK,
      message: `${unchanged} screenshots already correct across ${summary.length} set(s)`,
      details,
      findings,
    };
  }
  return {
    status: Status.CHANGED,
    message: `${uploaded} uploaded, ${unchanged} unchanged${deleted ? `, ${deleted} removed` : ""} across ${summary.length} set(s)`,
    details,
    findings,
  };
}

/** Diff and reconcile one display type in one locale. */
async function syncSet({ client, discovery, uploader, dryRun }, { version, set, local, prune, findings }) {
  const verLoc = await discovery.versionLocalization(version.id, set.locale);

  const existingSets = await client.all(`/v1/appStoreVersionLocalizations/${verLoc.id}/appScreenshotSets`, {
    limit: 50,
  });
  let remoteSet = existingSets.find((s) => s.attributes.screenshotDisplayType === set.displayType);
  if (!remoteSet) {
    remoteSet = (
      await client.post(`/v1/appScreenshotSets`, {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: set.displayType },
          relationships: {
            appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: verLoc.id } },
          },
        },
      })
    ).data;
  }

  const remote =
    dryRun && String(remoteSet.id).startsWith("dry:")
      ? []
      : await client.all(
          `/v1/appScreenshotSets/${remoteSet.id}/appScreenshots` +
            `?fields[appScreenshots]=fileName,fileSize,sourceFileChecksum,assetDeliveryState`,
          { limit: 50 },
        );

  // An upload that never finished its commit step is worse than useless: Apple
  // ignores it and the UI gives no hint why. Treat it as absent so we replace it.
  const usable = remote.filter((r) => r.attributes.assetDeliveryState?.state === "COMPLETE");
  const stale = remote.filter((r) => r.attributes.assetDeliveryState?.state !== "COMPLETE");

  const claimed = new Set();
  const matchFor = (item) =>
    usable.find(
      (r) =>
        !claimed.has(r.id) &&
        (r.attributes.sourceFileChecksum
          ? r.attributes.sourceFileChecksum === item.checksum
          : r.attributes.fileName === item.file && r.attributes.fileSize === item.size),
    );

  const ordered = [];
  const uploaded = [];
  for (const item of local) {
    const match = matchFor(item);
    if (match) {
      claimed.add(match.id);
      ordered.push(match.id);
      continue;
    }
    const id = await uploader.upload({
      reservePath: `/v1/appScreenshots`,
      type: "appScreenshots",
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: remoteSet.id } } },
      filePath: item.path,
      fileName: item.file,
    });
    ordered.push(id);
    uploaded.push(item.file);
  }

  // Half-finished uploads always go; real orphans only when asked. The CLI asks
  // by default because a human typed the command, the MCP tool does not, because
  // a model should not discover deletion by omitting an argument.
  const orphans = usable.filter((r) => !claimed.has(r.id));
  const toDelete = [...stale, ...(prune ? orphans : [])];
  for (const r of toDelete) await client.delete(`/v1/appScreenshots/${r.id}`, { throwOnError: false });

  if (!prune && orphans.length) {
    findings.push(
      finding({
        id: `screenshots.orphans.kept.${set.displayType}.${set.locale}`,
        severity: Severity.WARNING,
        category: Category.ASC_STATE,
        title: `${orphans.length} remote ${set.displayType} screenshot(s) for ${set.locale} have no local counterpart`,
        detail: orphans.map((r) => r.attributes.fileName).join(", "),
        fixOwner: FixOwner.CLI,
        fix: "Re-run with prune enabled to remove them, or add the matching files locally.",
      }),
    );
  }

  // Ordering is how filename order becomes display order, but sending it when it
  // already matches would mean a "nothing changed" run still wrote something —
  // and the idempotency claim has to be literally true to be worth making.
  const currentOrder = remote.filter((r) => !toDelete.includes(r)).map((r) => r.id);
  const orderDiffers = currentOrder.length !== ordered.length || currentOrder.some((id, i) => id !== ordered[i]);
  if (orderDiffers) {
    await client.patch(`/v1/appScreenshotSets/${remoteSet.id}/relationships/appScreenshots`, {
      data: ordered.map((id) => ({ type: "appScreenshots", id })),
    });
  }

  return {
    displayType: set.displayType,
    locale: set.locale,
    total: local.length,
    uploaded,
    deleted: toDelete.map((r) => r.attributes?.fileName ?? r.id),
    unchanged: local.length - uploaded.length,
    reordered: orderDiffers,
    changed: Boolean(uploaded.length || toDelete.length || orderDiffers),
  };
}
