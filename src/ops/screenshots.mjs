// Sync the local PNGs to the version's screenshot set.
//
// The old version deleted every remote screenshot and re-uploaded everything.
// Two problems with that: a failure partway through left the listing with fewer
// screenshots than it started with, and it could never report "already correct".
// Now we diff first — App Store Connect stores the md5 it was committed with, so
// matching it against the local file tells us exactly what changed.

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { Status } from "../core/status.mjs";
import { AssetUploader } from "../asc/assets.mjs";
import { readPngHeader, DISPLAY_TYPE_SIZES } from "../asc/png.mjs";
import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";

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
      description: "override config.screenshots.displayType",
    },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ prune?: boolean, displayType?: string }} [args]
 */
export async function run({ client, discovery, uploader, config, resolvePath, dryRun }, args = {}) {
  const dir = config.screenshots.dir;
  const absDir = resolvePath(dir, "config.screenshots.dir");
  if (!existsSync(absDir)) {
    return { status: Status.ERROR, message: `${dir} does not exist (looked in ${absDir})` };
  }

  const files = readdirSync(absDir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort(); // filename order is display order
  if (!files.length) return { status: Status.ERROR, message: `no PNGs found in ${dir}` };

  const displayType = args.displayType || config.screenshots.displayType || "APP_IPHONE_67";
  const expected = DISPLAY_TYPE_SIZES[displayType];

  // Validate every file locally before touching the network. Uploading a
  // wrongly-sized PNG costs a round trip and a confusing 409.
  const findings = [];
  const local = [];
  for (const file of files) {
    const path = join(absDir, file);
    const header = readPngHeader(path);
    if (expected && header && (header.width !== expected.width || header.height !== expected.height)) {
      findings.push(
        finding({
          id: "screenshots.dimensions.invalid",
          category: Category.ASSET,
          title: `${file} is ${header.width}×${header.height}, not ${expected.width}×${expected.height}`,
          detail: `App Store Connect accepts only the exact size for ${displayType}.`,
          fixOwner: FixOwner.EXTERNAL,
          fix: `Re-render ${file} at ${expected.width}×${expected.height}.`,
        }),
      );
      continue;
    }
    const { checksum, size } = AssetUploader.read(path);
    local.push({ file, path, checksum, size });
  }
  if (findings.length) {
    return {
      status: Status.ERROR,
      message: `${findings.length} screenshot(s) are the wrong size for ${displayType}`,
      findings,
    };
  }

  const version = await discovery.editableVersion();
  const verLoc = await discovery.versionLocalization(version.id, config.locale);

  const sets = await client.all(`/v1/appStoreVersionLocalizations/${verLoc.id}/appScreenshotSets`, { limit: 50 });
  let set = sets.find((s) => s.attributes.screenshotDisplayType === displayType);
  if (!set) {
    set = (
      await client.post(`/v1/appScreenshotSets`, {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: displayType },
          relationships: {
            appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: verLoc.id } },
          },
        },
      })
    ).data;
  }

  const remote =
    dryRun && set.id.startsWith("dry:")
      ? []
      : await client.all(
          `/v1/appScreenshotSets/${set.id}/appScreenshots` +
            `?fields[appScreenshots]=fileName,fileSize,sourceFileChecksum,assetDeliveryState`,
          { limit: 50 },
        );

  // An upload that never finished its commit step is worse than useless: Apple
  // ignores it and the UI gives no hint why. Treat it as absent so we re-upload.
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

  /** @type {Array<{id: string}>} */
  const ordered = [];
  const uploaded = [];
  for (const item of local) {
    const match = matchFor(item);
    if (match) {
      claimed.add(match.id);
      ordered.push({ id: match.id });
      continue;
    }
    const id = await uploader.upload({
      reservePath: `/v1/appScreenshots`,
      type: "appScreenshots",
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } },
      filePath: item.path,
      fileName: item.file,
    });
    ordered.push({ id });
    uploaded.push(item.file);
  }

  // Anything left over: half-finished uploads always go, real orphans only when
  // asked. The CLI asks by default because a human typed the command; the MCP
  // tool does not, because a model should not delete by omission.
  const orphans = usable.filter((r) => !claimed.has(r.id));
  const toDelete = [...stale, ...(args.prune ? orphans : [])];
  for (const r of toDelete) await client.delete(`/v1/appScreenshots/${r.id}`, { throwOnError: false });

  const keptOrphans = args.prune ? [] : orphans;
  if (keptOrphans.length) {
    findings.push(
      finding({
        id: "screenshots.orphans.kept",
        severity: Severity.WARNING,
        category: Category.ASC_STATE,
        title: `${keptOrphans.length} remote screenshot(s) have no local counterpart`,
        detail: keptOrphans.map((r) => r.attributes.fileName).join(", "),
        fixOwner: FixOwner.CLI,
        fix: "Re-run with prune enabled to remove them, or add the matching files locally.",
      }),
    );
  }

  // Ordering is how filename order becomes display order, but sending it when it
  // already matches would mean a "nothing changed" run still wrote something —
  // and the idempotency claim has to be literally true to be worth making.
  const currentOrder = remote.filter((r) => !toDelete.includes(r)).map((r) => r.id);
  const wantedOrder = ordered.map(({ id }) => id);
  const orderDiffers =
    currentOrder.length !== wantedOrder.length || currentOrder.some((id, i) => id !== wantedOrder[i]);

  if (orderDiffers) {
    await client.patch(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
      data: wantedOrder.map((id) => ({ type: "appScreenshots", id })),
    });
  }

  const changed = uploaded.length || toDelete.length || orderDiffers;
  const details = {
    displayType,
    total: local.length,
    uploaded,
    deleted: toDelete.map((r) => r.attributes?.fileName ?? r.id),
    unchanged: local.length - uploaded.length,
    reordered: orderDiffers,
  };

  if (!changed) {
    return {
      status: Status.OK,
      message: `${local.length} screenshots already correct (${displayType})`,
      details,
      findings,
    };
  }
  return {
    status: Status.CHANGED,
    message:
      `${displayType}: ${uploaded.length} uploaded, ${details.unchanged} unchanged` +
      (toDelete.length ? `, ${toDelete.length} removed` : ""),
    details,
    findings,
  };
}
