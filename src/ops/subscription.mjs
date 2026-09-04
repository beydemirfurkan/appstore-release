// Completes a subscription (group localization, subscription localization, price, and
// the App Review paywall screenshot) so it leaves MISSING_METADATA → READY_TO_SUBMIT.
// Note: attaching a FIRST-TIME subscription to the version + submitting is UI-only (see submit.mjs).
import { Status } from "../core/status.mjs";
import { AssetUploader } from "../asc/assets.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "subscription",
  title: "Subscription",
  phase: "listing",
  needs: ["subscription"],
  mutates: true,
  destructive: true,
};

export async function run({ client, discovery, uploader, config, resolvePath }) {
  const cfg = config?.subscription;
  if (!cfg || !cfg.productId) return { status: Status.SKIPPED, message: "no subscription configured" };

  const { group, sub } = await discovery.subscription(cfg.productId);
  if (!sub) return { status: Status.ERROR, message: `subscription not found: ${cfg.productId}` };
  const changes = [];

  // Group localization (user-facing group name)
  if (group && cfg.groupDisplayName) {
    const glocs = await client.get(`/v1/subscriptionGroups/${group.id}/subscriptionGroupLocalizations?limit=50`);
    if (!glocs.data.some((l) => l.attributes.locale === config.locale)) {
      await client.post(`/v1/subscriptionGroupLocalizations`, {
        data: {
          type: "subscriptionGroupLocalizations",
          attributes: { locale: config.locale, name: cfg.groupDisplayName },
          relationships: { subscriptionGroup: { data: { type: "subscriptionGroups", id: group.id } } },
        },
      });
      changes.push("group loc");
    }
  }

  // Subscription localization (display name + description)
  if (cfg.localeName) {
    const slocs = await client.get(`/v1/subscriptions/${sub.id}/subscriptionLocalizations?limit=50`);
    if (!slocs.data.some((l) => l.attributes.locale === config.locale)) {
      await client.post(`/v1/subscriptionLocalizations`, {
        data: {
          type: "subscriptionLocalizations",
          attributes: { locale: config.locale, name: cfg.localeName, description: cfg.localeDescription || undefined },
          relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } },
        },
      });
      changes.push("sub loc");
    }
  }

  // Price (nearest price point in the base territory; replaces existing)
  if (cfg.priceTerritory && cfg.priceAmount != null) {
    const pp = await client.get(
      `/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=${cfg.priceTerritory}&limit=200`,
    );
    const pts = (pp.data || []).map((d) => ({ id: d.id, price: parseFloat(d.attributes.customerPrice) }));
    if (pts.length) {
      const target = pts.reduce(
        (best, c) => (Math.abs(c.price - cfg.priceAmount) < Math.abs(best.price - cfg.priceAmount) ? c : best),
        pts[0],
      );
      // Only replace when the target differs. Deleting and recreating an
      // identical price on every run was the reason this operation could never
      // honestly report "already correct".
      const current = await client.get(`/v1/subscriptions/${sub.id}/prices?include=subscriptionPricePoint&limit=50`);
      const alreadySet = (current.data || []).some((pr) =>
        (current.included || []).some(
          (inc) =>
            inc.type === "subscriptionPricePoints" &&
            inc.id === pr.relationships?.subscriptionPricePoint?.data?.id &&
            inc.id === target.id,
        ),
      );
      if (!alreadySet) {
        for (const pr of current.data || [])
          await client.delete(`/v1/subscriptionPrices/${pr.id}`, { throwOnError: false });
        await client.post(`/v1/subscriptionPrices`, {
          data: {
            type: "subscriptionPrices",
            attributes: { preserveCurrentPrice: false },
            relationships: {
              subscription: { data: { type: "subscriptions", id: sub.id } },
              subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: target.id } },
            },
          },
        });
        changes.push(`price ${target.price}`);
      }
    }
  }

  // App Review paywall screenshot (required to leave MISSING_METADATA)
  if (cfg.reviewScreenshot) {
    const filePath = resolvePath(cfg.reviewScreenshot, "config.subscription.reviewScreenshot");
    const local = AssetUploader.read(filePath);
    const existing = await client.get(`/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`, { throwOnError: false });
    const remote = existing.error ? null : existing.data;

    // Same file, already committed: leave it alone. Re-uploading an identical
    // screenshot on every run is what made this always report CHANGED.
    const identical =
      remote?.attributes?.sourceFileChecksum === local.checksum &&
      remote?.attributes?.assetDeliveryState?.state === "COMPLETE";

    if (!identical) {
      if (remote) {
        await client.delete(`/v1/subscriptionAppStoreReviewScreenshots/${remote.id}`, { throwOnError: false });
      }
      await uploader.upload({
        reservePath: `/v1/subscriptionAppStoreReviewScreenshots`,
        type: "subscriptionAppStoreReviewScreenshots",
        relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } },
        filePath,
      });
      changes.push("review screenshot");
    }
  }

  if (!changes.length) return { status: Status.OK, message: `${cfg.productId} already complete` };
  return { status: Status.CHANGED, message: `${cfg.productId}: ${changes.join(", ")}` };
}
