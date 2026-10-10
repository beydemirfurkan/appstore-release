// Promotional offers and offer codes on a subscription, from the config.
//
// Apple's model (App Store Connect API 4.5.1): an offer's terms — mode,
// duration, periods, and for a promotional offer its name and offerCode — are
// fixed once created; only an offer code's `active` flag, and a promotional
// offer's price list, can change. So this creates what is missing, deactivates
// what the config turns off, and reports any other difference rather than
// pretending to fix it. Nothing is ever deleted: offer codes have no DELETE,
// and a promotional offer in use must not vanish because a config line did.
//
// Prices: Apple documents no equalization for offers, so an offer exists only in
// the territories the config names — the plan's priceTerritory, plus `prices`
// for a paid offer or `territories` for a free one.

import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";
import { nearestPricePoint } from "../core/price.mjs";

/**
 * @typedef {Object} OfferTerms
 * @property {"FREE_TRIAL"|"PAY_AS_YOU_GO"|"PAY_UP_FRONT"} type
 * @property {string} duration
 * @property {number} [periods]
 * @property {number} [priceAmount]
 * @property {Record<string, number>} [prices]
 * @property {string[]} [territories]
 */

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {import("../core/products.mjs").SubscriptionConfig & { promotionalOffers?: any[], offerCodes?: any[] }} product
 * @param {any} sub
 * @param {boolean} planned   the subscription itself was only planned (dry run)
 * @param {string[]} changes
 * @returns {Promise<import("../core/findings.mjs").Finding[]>}
 */
export async function completeOffers(ctx, product, sub, planned, changes) {
  const findings = [];
  if (product.promotionalOffers?.length)
    findings.push(...(await promotionalOffers(ctx, product, sub, planned, changes)));
  if (product.offerCodes?.length) findings.push(...(await offerCodes(ctx, product, sub, planned, changes)));
  return findings;
}

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {any} product
 * @param {any} sub
 * @param {boolean} planned
 * @param {string[]} changes
 */
async function promotionalOffers({ client }, product, sub, planned, changes) {
  const findings = [];
  const existing = planned ? [] : await client.all(`/v1/subscriptions/${sub.id}/promotionalOffers`, { limit: 200 });
  for (const want of product.promotionalOffers) {
    const found = existing.find((o) => o.attributes?.offerCode === want.offerCode);
    if (found) {
      const drift = termsDrift(found.attributes, want, { name: want.name });
      if (drift.length) {
        findings.push(
          immutable(
            `subscription.promotional-offer.changed.${want.offerCode}`,
            `Promotional offer ${want.offerCode}`,
            drift,
          ),
        );
      }
      continue;
    }
    const prices = await offerPrices(client, product, want, sub, planned, "subscriptionPromotionalOfferPrices");
    if (!prices.ok) {
      findings.push(prices.finding);
      continue;
    }
    await client.post(`/v1/subscriptionPromotionalOffers`, {
      data: {
        type: "subscriptionPromotionalOffers",
        attributes: {
          name: want.name,
          offerCode: want.offerCode,
          offerMode: want.type,
          duration: want.duration,
          numberOfPeriods: want.periods ?? 1,
        },
        relationships: {
          subscription: { data: { type: "subscriptions", id: sub.id } },
          prices: { data: prices.refs },
        },
      },
      included: prices.included,
    });
    changes.push(`promotional offer ${want.offerCode}`);
  }
  return findings;
}

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {any} product
 * @param {any} sub
 * @param {boolean} planned
 * @param {string[]} changes
 */
async function offerCodes({ client }, product, sub, planned, changes) {
  const findings = [];
  const existing = planned ? [] : await client.all(`/v1/subscriptions/${sub.id}/offerCodes`, { limit: 200 });
  for (const want of product.offerCodes) {
    let code = existing.find((o) => o.attributes?.name === want.name);
    const active = want.active ?? true;
    if (code) {
      const drift = termsDrift(code.attributes, want, {
        customerEligibilities: [...want.eligibility].sort().join(","),
        offerEligibility: want.stackWithIntroOffer ? "STACK_WITH_INTRO_OFFERS" : "REPLACE_INTRO_OFFERS",
      });
      if (drift.length) {
        findings.push(immutable(`subscription.offer-code.changed.${want.name}`, `Offer code "${want.name}"`, drift));
      }
      if (code.attributes?.active !== false && !active) {
        await client.patch(`/v1/subscriptionOfferCodes/${code.id}`, {
          data: { type: "subscriptionOfferCodes", id: code.id, attributes: { active: false } },
        });
        changes.push(`offer code ${want.name} deactivated`);
      } else if (code.attributes?.active === false && active) {
        findings.push(
          finding({
            id: `subscription.offer-code.inactive.${want.name}`,
            severity: Severity.WARNING,
            category: Category.ASC_STATE,
            title: `Offer code "${want.name}" is deactivated in App Store Connect`,
            detail: "A deactivated offer code is not turned back on here; its codes stay unredeemable.",
            fixOwner: FixOwner.CLI,
            fix: "Give the offer a new name to create a fresh one, or set active: false to match.",
          }),
        );
      }
    } else {
      if (!active) continue; // nothing to create just to turn off
      const prices = await offerPrices(client, product, want, sub, planned, "subscriptionOfferCodePrices");
      if (!prices.ok) {
        findings.push(prices.finding);
        continue;
      }
      code = (
        await client.post(`/v1/subscriptionOfferCodes`, {
          data: {
            type: "subscriptionOfferCodes",
            attributes: {
              name: want.name,
              customerEligibilities: want.eligibility,
              offerEligibility: want.stackWithIntroOffer ? "STACK_WITH_INTRO_OFFERS" : "REPLACE_INTRO_OFFERS",
              offerMode: want.type,
              duration: want.duration,
              numberOfPeriods: want.periods ?? 1,
              ...(want.autoRenew === undefined ? {} : { autoRenewEnabled: want.autoRenew }),
            },
            relationships: {
              subscription: { data: { type: "subscriptions", id: sub.id } },
              prices: { data: prices.refs },
            },
          },
          included: prices.included,
        })
      ).data;
      changes.push(`offer code ${want.name}`);
    }

    if (want.customCodes?.length) await customCodes(client, code, want, changes);
  }
  return findings;
}

/**
 * Custom codes of one offer code: created when missing, deactivated when the
 * config says so. Matched by the code itself, case-insensitively, as Apple
 * treats them.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {any} code   the offer code resource (possibly planned)
 * @param {any} want
 * @param {string[]} changes
 */
async function customCodes(client, code, want, changes) {
  const planned = String(code.id).startsWith("dry:");
  const existing = planned ? [] : await client.all(`/v1/subscriptionOfferCodes/${code.id}/customCodes`, { limit: 200 });
  for (const c of want.customCodes) {
    const found = existing.find((e) => String(e.attributes?.customCode).toUpperCase() === c.code.toUpperCase());
    const active = c.active ?? true;
    if (!found) {
      if (!active) continue;
      await client.post(`/v1/subscriptionOfferCodeCustomCodes`, {
        data: {
          type: "subscriptionOfferCodeCustomCodes",
          attributes: {
            customCode: c.code,
            numberOfCodes: c.count,
            ...(c.expires ? { expirationDate: c.expires } : {}),
          },
          relationships: { offerCode: { data: { type: "subscriptionOfferCodes", id: code.id } } },
        },
      });
      changes.push(`custom code ${c.code}`);
    } else if (found.attributes?.active !== false && !active) {
      await client.patch(`/v1/subscriptionOfferCodeCustomCodes/${found.id}`, {
        data: { type: "subscriptionOfferCodeCustomCodes", id: found.id, attributes: { active: false } },
      });
      changes.push(`custom code ${c.code} deactivated`);
    }
  }
}

/**
 * The inline price list an offer is created with: one entry per territory.
 * A free offer names only territories; a paid one needs a price point in each,
 * the nearest to the configured amount.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {any} product
 * @param {OfferTerms} want
 * @param {any} sub
 * @param {boolean} planned
 * @param {string} type   the inline price resource type
 * @returns {Promise<{ ok: true, refs: any[], included: any[] } | { ok: false, finding: import("../core/findings.mjs").Finding }>}
 */
async function offerPrices(client, product, want, sub, planned, type) {
  /** @type {Array<{ territory: string, amount: number|null }>} */
  const territories =
    want.type === "FREE_TRIAL"
      ? (want.territories?.length ? want.territories : [product.priceTerritory]).map((t) => ({
          territory: t,
          amount: null,
        }))
      : [
          ...(want.priceAmount != null ? [{ territory: product.priceTerritory, amount: want.priceAmount }] : []),
          ...Object.entries(want.prices ?? {}).map(([territory, amount]) => ({ territory, amount })),
        ];
  if (!territories.length) {
    return {
      ok: false,
      finding: finding({
        id: `subscription.offer.no-price.${product.productId}`,
        category: Category.CONFIG,
        title: `A ${want.type} offer on ${product.productId} has no price`,
        detail: "PAY_AS_YOU_GO and PAY_UP_FRONT offers need priceAmount (in the plan's priceTerritory) or prices.",
        fixOwner: FixOwner.CLI,
        fix: 'Add priceAmount, or prices: { "USA": 1.99 }.',
      }),
    };
  }

  const refs = [];
  const included = [];
  for (const [i, { territory, amount }] of territories.entries()) {
    const id = `\${${type}-${i}}`;
    /** @type {Record<string, any>} */
    const relationships = { territory: { data: { type: "territories", id: territory } } };
    if (amount != null && !planned) {
      const points = await client.all(`/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=${territory}`, {
        limit: 200,
      });
      const point = nearestPricePoint(points, amount);
      if (!point) {
        return {
          ok: false,
          finding: finding({
            id: `subscription.offer.no-price-point.${territory}`,
            category: Category.CONFIG,
            title: `No price point near ${amount} in ${territory}`,
            detail: `${product.productId} has no price points in ${territory}; is the subscription available there?`,
            fixOwner: FixOwner.CLI,
            fix: "Use a territory the subscription is sold in.",
          }),
        };
      }
      relationships.subscriptionPricePoint = { data: { type: "subscriptionPricePoints", id: point.id } };
    }
    refs.push({ type, id });
    included.push({ type, id, relationships });
  }
  return { ok: true, refs, included };
}

/**
 * What differs between an offer App Store Connect has and the config.
 * @param {any} remote   its attributes
 * @param {OfferTerms} want
 * @param {Record<string, string>} [extra]   more attribute → expected value pairs
 */
function termsDrift(remote, want, extra = {}) {
  const expected = {
    offerMode: want.type,
    duration: want.duration,
    numberOfPeriods: String(want.periods ?? 1),
    ...extra,
  };
  const actual = (/** @type {string} */ key) =>
    key === "customerEligibilities"
      ? [...(remote?.customerEligibilities ?? [])].sort().join(",")
      : String(remote?.[key] ?? "");
  return Object.entries(expected)
    .filter(([key, value]) => actual(key) !== String(value))
    .map(([key, value]) => `${key}: ${actual(key) || "—"} in App Store Connect, ${value} in the config`);
}

/** @param {string} id @param {string} what @param {string[]} drift */
function immutable(id, what, drift) {
  return finding({
    id,
    severity: Severity.WARNING,
    category: Category.ASC_STATE,
    title: `${what} differs from the config, and Apple does not allow changing it`,
    detail: `${drift.join("; ")}.`,
    fixOwner: FixOwner.CLI,
    fix: "Match the config to App Store Connect, or give the offer a new name or offerCode to create another.",
  });
}
