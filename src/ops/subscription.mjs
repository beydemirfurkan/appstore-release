// Completes every configured auto-renewable subscription — creating the group
// and the product when they do not exist yet — so each leaves MISSING_METADATA
// for READY_TO_SUBMIT: group and subscription localizations, a price, the App
// Review paywall screenshot, and an introductory offer when one is configured.
//
// Submitting is submit's job, the app's first subscription included (see
// submit.mjs for what happens if App Store Connect will not take it by API).
import { Status } from "../core/status.mjs";
import { forgetRefusals } from "../core/state.mjs";
import { AssetUploader } from "../asc/assets.mjs";
import { nearestPricePoint } from "../core/price.mjs";
import { subscriptionConfigs, productTexts, missingProductFields } from "../core/products.mjs";
import { completeOffers } from "./offers.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "subscription",
  title: "Subscriptions",
  phase: "listing",
  needs: [],
  mutates: true,
  destructive: true,
};

/** @param {import("../core/context.mjs").Context} ctx */
export async function run(ctx) {
  const { client, discovery, config } = ctx;
  const products = subscriptionConfigs(config);
  if (!products.length) return { status: Status.SKIPPED, message: "none configured" };

  const findings = products.flatMap((p, i) => missingProductFields(p, "subscriptions", i));
  if (findings.length) {
    return { status: Status.ERROR, message: `${findings.length} subscription field(s) missing`, findings };
  }

  const r = await client.get(`/v1/apps/${discovery.appId}/subscriptionGroups?include=subscriptions&limit=50`);
  const groups = r.data ?? [];
  const subs = (r.included ?? []).filter((x) => x.type === "subscriptions");

  /** @type {Array<{ productId: string, changes: string[] }>} */
  const done = [];
  /** @type {import("../core/findings.mjs").Finding[]} */
  const offerFindings = [];
  for (const product of products) {
    const changes = [];
    let sub = subs.find((s) => s.attributes.productId === product.productId);
    let group = sub
      ? groups.find((g) => (g.relationships?.subscriptions?.data ?? []).some((d) => d.id === sub?.id))
      : product.group
        ? groups.find((g) => g.attributes.referenceName === product.group)
        : groups[0];

    if (!sub) {
      if (!product.name || !product.period) {
        return {
          status: Status.ERROR,
          message: `${product.productId} does not exist yet; set its name and period to create it`,
        };
      }
      if (!group) {
        group = (
          await client.post(`/v1/subscriptionGroups`, {
            data: {
              type: "subscriptionGroups",
              attributes: { referenceName: product.group ?? "Subscriptions" },
              relationships: { app: { data: { type: "apps", id: discovery.appId } } },
            },
          })
        ).data;
        groups.push(group);
        changes.push("group created");
      }
      sub = (
        await client.post(`/v1/subscriptions`, {
          data: {
            type: "subscriptions",
            attributes: {
              name: product.name,
              productId: product.productId,
              subscriptionPeriod: product.period,
              ...(product.groupLevel != null ? { groupLevel: product.groupLevel } : {}),
              ...(product.familySharable != null ? { familySharable: product.familySharable } : {}),
              ...(product.reviewNote ? { reviewNote: product.reviewNote } : {}),
            },
            relationships: { group: { data: { type: "subscriptionGroups", id: group.id } } },
          },
        })
      ).data;
      changes.push("created");
    }

    offerFindings.push(...(await completeSubscription(ctx, product, sub, group, changes)));
    done.push({ productId: product.productId, changes });
    // A product that just changed may now be acceptable: forget an earlier refusal.
    if (changes.length && !ctx.dryRun && ctx.stateDir)
      forgetRefusals(ctx.stateDir, discovery.appId, [product.productId]);
  }

  const changed = done.filter((d) => d.changes.length);
  if (!changed.length) {
    return {
      status: Status.OK,
      message: products.length === 1 ? "already complete" : `${products.length} plans complete`,
      findings: offerFindings,
    };
  }
  return {
    status: Status.CHANGED,
    message:
      products.length === 1 ? summarize(changed[0].changes) : `${changed.length} of ${products.length} plans updated`,
    details: { products: done },
    findings: offerFindings,
  };
}

/**
 * Localizations, price, review screenshot, introductory offer, promotional
 * offers and offer codes for one plan. Each part writes only what differs; what
 * Apple will not let change comes back as findings.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {import("../core/products.mjs").SubscriptionConfig} product
 * @param {any} sub
 * @param {any} group
 * @param {string[]} changes
 */
async function completeSubscription(ctx, product, sub, group, changes) {
  const { client, uploader, config, resolvePath } = ctx;
  // A plan created a moment ago under --dry-run has a placeholder id; there is
  // nothing to read about it yet, only things it would get.
  const planned = String(sub.id).startsWith("dry:");
  const list = async (/** @type {string} */ path) => (planned ? [] : client.all(path, { limit: 50 }));

  // Localizations: the config's locale from the flat fields, plus any other
  // locale in `localizations`. Existing ones are corrected, not just created.
  const texts = productTexts(product, config.locale);
  if (group) {
    const glocs = String(group.id).startsWith("dry:")
      ? []
      : await client.all(`/v1/subscriptionGroups/${group.id}/subscriptionGroupLocalizations`, { limit: 50 });
    for (const { locale, groupName } of texts) {
      if (!groupName) continue;
      const res = await upsertLocalization(
        client,
        glocs,
        locale,
        { name: groupName },
        {
          type: "subscriptionGroupLocalizations",
          relationships: { subscriptionGroup: { data: { type: "subscriptionGroups", id: group.id } } },
        },
      );
      if (res) changes.push(`group ${res} ${locale}`);
    }
  }
  const slocs = await list(`/v1/subscriptions/${sub.id}/subscriptionLocalizations`);
  for (const { locale, name, description } of texts) {
    if (!name) continue;
    const res = await upsertLocalization(
      client,
      slocs,
      locale,
      { name, description: description || undefined },
      {
        type: "subscriptionLocalizations",
        relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } },
      },
    );
    if (res) changes.push(`${res} ${locale}`);
  }

  // Price: the nearest price point in the base territory; Apple equalizes the
  // rest. Every page of points is read — "nearest" over the first 200 alone
  // picked the wrong price for anything above them.
  if (product.priceAmount != null) {
    if (planned) {
      changes.push(`price ${product.priceAmount}`);
    } else {
      const points = await client.all(
        `/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=${product.priceTerritory}`,
        { limit: 200 },
      );
      const target = nearestPricePoint(points, product.priceAmount);
      if (target) {
        // Only the configured territory: other territories' prices, and anything
        // scheduled there, are not this config's to delete.
        const current = await client.get(
          `/v1/subscriptions/${sub.id}/prices?filter[territory]=${product.priceTerritory}&include=subscriptionPricePoint&limit=50`,
        );
        const alreadySet = (current.data ?? []).some(
          (pr) => pr.relationships?.subscriptionPricePoint?.data?.id === target.id,
        );
        if (!alreadySet) {
          for (const pr of current.data ?? []) {
            await client.delete(`/v1/subscriptionPrices/${pr.id}`, { throwOnError: false });
          }
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
  }

  // App Review paywall screenshot (required to leave MISSING_METADATA).
  if (product.reviewScreenshot) {
    const filePath = resolvePath(product.reviewScreenshot, `subscriptions.${product.productId}.reviewScreenshot`);
    const local = AssetUploader.read(filePath);
    const existing = planned
      ? { error: true, data: null }
      : await client.get(`/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`, { throwOnError: false });
    const remote = existing.error ? null : existing.data;
    // Same file, already committed: leave it alone.
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

  if (product.introOffer) {
    const offer = await introOffer(client, product, sub, planned);
    if (offer) changes.push(offer);
  }

  return completeOffers(ctx, product, sub, planned, changes);
}

/**
 * The introductory offer: a free trial, or a discounted first period(s). Created
 * once; an existing offer of the same shape is left alone.
 *
 * Territories: a free trial has no price and is created without a territory. A
 * paid offer is priced in the base territory only — Apple documents no
 * equalization for offers, so other territories are not guessed at.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {import("../core/products.mjs").SubscriptionConfig} product
 * @param {any} sub
 * @param {boolean} planned
 * @returns {Promise<string|null>}
 */
async function introOffer(client, product, sub, planned) {
  const want = /** @type {NonNullable<typeof product.introOffer>} */ (product.introOffer);
  const numberOfPeriods = want.periods ?? 1;
  const existing = planned ? [] : await client.all(`/v1/subscriptions/${sub.id}/introductoryOffers`, { limit: 200 });
  const same = existing.find(
    (o) =>
      o.attributes?.offerMode === want.type &&
      o.attributes?.duration === want.duration &&
      (o.attributes?.numberOfPeriods ?? 1) === numberOfPeriods,
  );
  if (same) return null;

  /** @type {Record<string, any>} */
  const relationships = { subscription: { data: { type: "subscriptions", id: sub.id } } };
  if (want.type !== "FREE_TRIAL") {
    const points = planned
      ? []
      : await client.all(`/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=${product.priceTerritory}`, {
          limit: 200,
        });
    const point = nearestPricePoint(points, want.priceAmount ?? 0);
    relationships.territory = { data: { type: "territories", id: product.priceTerritory } };
    if (point) relationships.subscriptionPricePoint = { data: { type: "subscriptionPricePoints", id: point.id } };
  }
  await client.post(`/v1/subscriptionIntroductoryOffers`, {
    data: {
      type: "subscriptionIntroductoryOffers",
      attributes: { offerMode: want.type, duration: want.duration, numberOfPeriods },
      relationships,
    },
  });
  return want.type === "FREE_TRIAL"
    ? `free trial (${want.duration.toLowerCase().replace(/_/g, " ")})`
    : `intro offer ${want.priceAmount ?? ""}`.trim();
}

/** "created · 2 localizations · price 4.99 · review screenshot" @param {string[]} changes */
function summarize(changes) {
  const isLoc = (/** @type {string} */ c) => /^(group )?(added|updated) /.test(c);
  const localized = changes.filter(isLoc).length;
  /** @type {string[]} */
  const head = changes.filter((c) => c === "created" || c === "group created");
  const rest = changes.filter((c) => !isLoc(c) && !head.includes(c));
  return [...head, ...(localized ? [`${localized} localization${localized === 1 ? "" : "s"}`] : []), ...rest].join(
    " · ",
  );
}

/**
 * Create the localization, or PATCH only what differs. Returns what happened,
 * or null when nothing needed to.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {any[]} existing
 * @param {string} locale
 * @param {Record<string, string|undefined>} attributes
 * @param {{ type: string, relationships: object, version?: string }} target
 */
export async function upsertLocalization(
  client,
  existing,
  locale,
  attributes,
  { type, relationships, version = "v1" },
) {
  const found = existing.find((l) => l.attributes?.locale === locale);
  if (!found) {
    await client.post(`/${version}/${type}`, { data: { type, attributes: { locale, ...attributes }, relationships } });
    return "added";
  }
  const diff = Object.fromEntries(
    Object.entries(attributes).filter(([k, v]) => v !== undefined && (found.attributes?.[k] ?? "") !== v),
  );
  if (!Object.keys(diff).length) return null;
  await client.patch(`/${version}/${type}/${found.id}`, { data: { type, id: found.id, attributes: diff } });
  return "updated";
}
