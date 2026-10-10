// Completes a subscription (group localization, subscription localization, price, and
// the App Review paywall screenshot) so it leaves MISSING_METADATA → READY_TO_SUBMIT.
// Submitting it — a first one included — is submit's job since API 4.4.1 (see submit.mjs).
import { Status } from "../core/status.mjs";
import { AssetUploader } from "../asc/assets.mjs";
import { nearestPricePoint } from "../core/price.mjs";

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

  // Localizations: the config's locale from the flat fields, plus any other
  // locale in `subscription.localizations`. Existing ones are corrected, not
  // just created — a renamed plan used to stay misnamed forever.
  const texts = subscriptionTexts(cfg, config.locale);
  if (group) {
    const glocs = await client.all(`/v1/subscriptionGroups/${group.id}/subscriptionGroupLocalizations`, { limit: 50 });
    for (const { locale, groupName } of texts) {
      if (!groupName) continue;
      const done = await upsertLocalization(
        client,
        glocs,
        locale,
        { name: groupName },
        {
          type: "subscriptionGroupLocalizations",
          relationships: { subscriptionGroup: { data: { type: "subscriptionGroups", id: group.id } } },
        },
      );
      if (done) changes.push(`group ${done} ${locale}`);
    }
  }
  const slocs = await client.all(`/v1/subscriptions/${sub.id}/subscriptionLocalizations`, { limit: 50 });
  for (const { locale, name, description } of texts) {
    if (!name) continue;
    const done = await upsertLocalization(
      client,
      slocs,
      locale,
      { name, description: description || undefined },
      {
        type: "subscriptionLocalizations",
        relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } },
      },
    );
    if (done) changes.push(`${done} ${locale}`);
  }

  // Price (nearest price point in the base territory; replaces existing)
  if (cfg.priceTerritory && cfg.priceAmount != null) {
    // Every page: a territory has hundreds of points, and "nearest" over the
    // first 200 alone silently picked the wrong price for anything above them.
    const points = await client.all(`/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=${cfg.priceTerritory}`, {
      limit: 200,
    });
    const target = nearestPricePoint(points, cfg.priceAmount);
    if (target) {
      // Only replace when the target differs. Deleting and recreating an
      // identical price on every run was the reason this operation could never
      // honestly report "already correct".
      // Scoped to the configured territory: the other territories' prices (and
      // anything scheduled there) are not this config's to delete.
      const current = await client.get(
        `/v1/subscriptions/${sub.id}/prices?filter[territory]=${cfg.priceTerritory}&include=subscriptionPricePoint&limit=50`,
      );
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
        changes.push(`price ${target.customerPrice}`);
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

/**
 * Per-locale subscription texts: the flat fields for the config's locale, then
 * each entry of `subscription.localizations`, inheriting what it leaves out.
 *
 * @param {any} cfg  config.subscription
 * @param {string} primary
 */
export function subscriptionTexts(cfg, primary) {
  const base = { name: cfg.localeName, description: cfg.localeDescription, groupName: cfg.groupDisplayName };
  const out = [{ locale: primary, ...base }];
  for (const [locale, t] of Object.entries(cfg.localizations ?? {})) {
    const entry = { locale, ...base, .../** @type {any} */ (t ?? {}) };
    const i = out.findIndex((e) => e.locale === locale);
    if (i === -1) out.push(entry);
    else out[i] = entry;
  }
  return out;
}

/**
 * Create the localization, or PATCH only what differs. Returns what happened,
 * or null when nothing needed to.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {any[]} existing
 * @param {string} locale
 * @param {Record<string, string|undefined>} attributes
 * @param {{ type: string, relationships: object }} target
 */
async function upsertLocalization(client, existing, locale, attributes, { type, relationships }) {
  const found = existing.find((l) => l.attributes?.locale === locale);
  if (!found) {
    await client.post(`/v1/${type}`, { data: { type, attributes: { locale, ...attributes }, relationships } });
    return "added";
  }
  const diff = Object.fromEntries(
    Object.entries(attributes).filter(([k, v]) => v !== undefined && (found.attributes?.[k] ?? "") !== v),
  );
  if (!Object.keys(diff).length) return null;
  await client.patch(`/v1/${type}/${found.id}`, { data: { type, id: found.id, attributes: diff } });
  return "updated";
}
