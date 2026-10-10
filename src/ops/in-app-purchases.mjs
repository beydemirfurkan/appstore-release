// One-time in-app purchases — a "lifetime" unlock, a consumable pack — created
// when missing and completed so each leaves MISSING_METADATA: localizations,
// availability, a price, and the App Review screenshot.
//
// Uses the non-deprecated shapes from App Store Connect API 4.4.1: products are
// created with POST /v2/inAppPurchases, and localizations attach to a draft
// in-app purchase *version*. The App Review screenshot still attaches to the
// product itself (v1), which Apple documents as unchanged.
//
// Submitting is submit's job, the app's first in-app purchase included (see
// submit.mjs for what happens if App Store Connect will not take it by API).
import { Status } from "../core/status.mjs";
import { AssetUploader } from "../asc/assets.mjs";
import { nearestPricePoint } from "../core/price.mjs";
import { purchaseConfigs, productTexts, missingProductFields } from "../core/products.mjs";
import { upsertLocalization } from "./subscription.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "in-app-purchases",
  title: "In-app purchases",
  phase: "listing",
  needs: [],
  mutates: true,
  destructive: true,
};

/** Version states whose localizations may still be edited. */
const DRAFT = ["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "REJECTED", "DEVELOPER_REJECTED"];

/** @param {import("../core/context.mjs").Context} ctx */
export async function run(ctx) {
  const { client, discovery, config } = ctx;
  const products = purchaseConfigs(config);
  if (!products.length) return { status: Status.SKIPPED, message: "none configured" };

  const findings = products.flatMap((p, i) => missingProductFields(p, "inAppPurchases", i));
  if (findings.length) {
    return { status: Status.ERROR, message: `${findings.length} in-app purchase field(s) missing`, findings };
  }

  /** @type {Array<{ productId: string, changes: string[] }>} */
  const done = [];
  for (const product of products) {
    const changes = [];
    const found = await client.get(
      `/v1/apps/${discovery.appId}/inAppPurchasesV2?filter[productId]=${encodeURIComponent(product.productId)}&limit=5`,
    );
    let iap = (found.data ?? []).find((p) => p.attributes?.productId === product.productId);
    if (!iap) {
      if (!product.name) {
        return { status: Status.ERROR, message: `${product.productId} does not exist yet; set its name to create it` };
      }
      iap = (
        await client.post(`/v2/inAppPurchases`, {
          data: {
            type: "inAppPurchases",
            attributes: {
              name: product.name,
              productId: product.productId,
              inAppPurchaseType: product.type,
              ...(product.familySharable != null ? { familySharable: product.familySharable } : {}),
              ...(product.reviewNote ? { reviewNote: product.reviewNote } : {}),
            },
            relationships: { app: { data: { type: "apps", id: discovery.appId } } },
          },
        })
      ).data;
      changes.push("created");
    }
    await completePurchase(ctx, product, iap, changes);
    done.push({ productId: product.productId, changes });
  }

  const changed = done.filter((d) => d.changes.length);
  if (!changed.length) {
    return { status: Status.OK, message: products.length === 1 ? "already complete" : `${products.length} complete` };
  }
  return {
    status: Status.CHANGED,
    message: products.length === 1 ? changed[0].changes.join(" · ") : `${changed.length} of ${products.length} updated`,
    details: { products: done },
  };
}

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {import("../core/products.mjs").PurchaseConfig} product
 * @param {any} iap
 * @param {string[]} changes
 */
async function completePurchase({ client, uploader, config, resolvePath }, product, iap, changes) {
  const planned = String(iap.id).startsWith("dry:");

  // Localizations live on a draft version. One is created only when a text
  // actually needs writing — an approved product with matching texts stays as is.
  const texts = productTexts(product, config.locale).filter((t) => t.name);
  const versions = planned ? [] : await client.all(`/v2/inAppPurchases/${iap.id}/versions`, { limit: 20 });
  const newest = [...versions].sort((a, b) => (b.attributes?.version ?? 0) - (a.attributes?.version ?? 0))[0];
  const currentLocs = newest
    ? await client.all(`/v1/inAppPurchaseVersions/${newest.id}/localizations`, { limit: 50 })
    : [];
  const stale = texts.filter((t) => {
    const loc = currentLocs.find((l) => l.attributes?.locale === t.locale);
    return !loc || loc.attributes?.name !== t.name || (t.description && loc.attributes?.description !== t.description);
  });
  if (stale.length) {
    let draft = newest && DRAFT.includes(newest.attributes?.state) ? newest : null;
    if (!draft) {
      draft = (
        await client.post(`/v1/inAppPurchaseVersions`, {
          data: {
            type: "inAppPurchaseVersions",
            relationships: { inAppPurchase: { data: { type: "inAppPurchases", id: iap.id } } },
          },
        })
      ).data;
    }
    const draftLocs = draft === newest ? currentLocs : [];
    for (const t of stale) {
      const res = await upsertLocalization(
        client,
        draftLocs,
        t.locale,
        { name: t.name, description: t.description || undefined },
        {
          type: "inAppPurchaseLocalizations",
          relationships: { version: { data: { type: "inAppPurchaseVersions", id: draft.id } } },
          version: "v2",
        },
      );
      if (res) changes.push(`${res} ${t.locale}`);
    }
  }

  // Availability: sold everywhere, and in new territories as Apple adds them.
  const availability = planned
    ? { error: true }
    : await client.get(`/v2/inAppPurchases/${iap.id}/inAppPurchaseAvailability`, { throwOnError: false });
  if (availability.error || !availability.data) {
    const territories = planned ? [] : await client.all(`/v1/territories`, { limit: 200 });
    await client.post(`/v1/inAppPurchaseAvailabilities`, {
      data: {
        type: "inAppPurchaseAvailabilities",
        attributes: { availableInNewTerritories: true },
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iap.id } },
          availableTerritories: { data: territories.map((t) => ({ type: "territories", id: t.id })) },
        },
      },
    });
    changes.push("available everywhere");
  }

  // Price: the nearest point in the base territory; Apple equalizes the rest.
  if (product.priceAmount != null) {
    const points = planned
      ? []
      : await client.all(`/v2/inAppPurchases/${iap.id}/pricePoints?filter[territory]=${product.priceTerritory}`, {
          limit: 200,
        });
    const target = nearestPricePoint(points, product.priceAmount);
    const current = planned
      ? { data: [] }
      : await client.get(
          `/v1/inAppPurchasePriceSchedules/${iap.id}/manualPrices?filter[territory]=${product.priceTerritory}&limit=10`,
          { throwOnError: false },
        );
    const set = (current.data ?? []).some((p) => p.relationships?.inAppPurchasePricePoint?.data?.id === target?.id);
    if (planned || (target && !set)) {
      await client.post(`/v1/inAppPurchasePriceSchedules`, {
        data: {
          type: "inAppPurchasePriceSchedules",
          relationships: {
            inAppPurchase: { data: { type: "inAppPurchases", id: iap.id } },
            baseTerritory: { data: { type: "territories", id: product.priceTerritory } },
            manualPrices: { data: [{ type: "inAppPurchasePrices", id: "${price1}" }] },
          },
        },
        included: [
          {
            type: "inAppPurchasePrices",
            id: "${price1}",
            attributes: { startDate: null },
            relationships: {
              inAppPurchaseV2: { data: { type: "inAppPurchases", id: iap.id } },
              inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: target?.id ?? "planned" } },
            },
          },
        ],
      });
      changes.push(`price ${target?.customerPrice ?? product.priceAmount}`);
    }
  }

  // App Review screenshot, on the product (not the version).
  if (product.reviewScreenshot) {
    const filePath = resolvePath(product.reviewScreenshot, `inAppPurchases.${product.productId}.reviewScreenshot`);
    const local = AssetUploader.read(filePath);
    const existing = planned
      ? { error: true, data: null }
      : await client.get(`/v2/inAppPurchases/${iap.id}/appStoreReviewScreenshot`, { throwOnError: false });
    const remote = existing.error ? null : existing.data;
    const identical =
      remote?.attributes?.sourceFileChecksum === local.checksum &&
      remote?.attributes?.assetDeliveryState?.state === "COMPLETE";
    if (!identical) {
      if (remote) {
        await client.delete(`/v1/inAppPurchaseAppStoreReviewScreenshots/${remote.id}`, { throwOnError: false });
      }
      await uploader.upload({
        reservePath: `/v1/inAppPurchaseAppStoreReviewScreenshots`,
        type: "inAppPurchaseAppStoreReviewScreenshots",
        relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iap.id } } },
        filePath,
      });
      changes.push("review screenshot");
    }
  }
}
