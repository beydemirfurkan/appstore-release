// The deprecated screenshot-set API: one set per display type per localization,
// screenshots committed with an md5 that App Store Connect stores — which makes
// the diff exact and cheap. Deprecated by Apple in API 4.5.1 in favour of the App
// Asset Library (./asset-library.mjs); kept for accounts and apps without one,
// and for `screenshots.api: "legacy"`.

/**
 * Diff and reconcile one display type in one locale.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ localizationId: string, displayType: string,
 *           local: Array<{ file: string, path: string, checksum: string, size: number }>, prune: boolean }} params
 */
export async function syncScreenshotSet({ client, uploader, dryRun }, { localizationId, displayType, local, prune }) {
  const verLoc = { id: localizationId };

  const existingSets = await client.all(`/v1/appStoreVersionLocalizations/${verLoc.id}/appScreenshotSets`, {
    limit: 50,
  });
  let remoteSet = existingSets.find((s) => s.attributes.screenshotDisplayType === displayType);
  if (!remoteSet) {
    remoteSet = (
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

  // Ordering is how filename order becomes display order, but sending it when it
  // already matches would mean a "nothing changed" run still wrote something —
  // and the idempotency claim has to be literally true to be worth making.
  // Orphans that stay keep their place after ours: comparing against only our
  // files made every no-prune run "reorder" a subset and report a change.
  const desired = [...ordered, ...(prune ? [] : orphans.map((r) => r.id))];
  const currentOrder = remote.filter((r) => !toDelete.includes(r)).map((r) => r.id);
  const orderDiffers = currentOrder.length !== desired.length || currentOrder.some((id, i) => id !== desired[i]);
  if (orderDiffers) {
    await client.patch(`/v1/appScreenshotSets/${remoteSet.id}/relationships/appScreenshots`, {
      data: desired.map((id) => ({ type: "appScreenshots", id })),
    });
  }

  return {
    uploaded,
    reused: [],
    deleted: toDelete.map((r) => r.attributes?.fileName ?? r.id),
    keptOrphans: prune ? [] : orphans.map((r) => r.attributes.fileName),
    unchanged: local.length - uploaded.length,
    reordered: orderDiffers,
    changed: Boolean(uploaded.length || toDelete.length || orderDiffers),
    planned: dryRun,
  };
}
