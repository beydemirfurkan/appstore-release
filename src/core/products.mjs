// What the config says to sell: auto-renewable subscriptions and one-time
// in-app purchases, normalised into lists. `subscription` (one object) is the
// v2 shape and still works; `subscriptions` (a list) is how several plans,
// tiers or groups are described.

import { finding, Category, FixOwner } from "./findings.mjs";

/**
 * @typedef {Object} SubscriptionConfig
 * @property {string} productId
 * @property {string} [name]            reference name; needed only to create the product
 * @property {string} [period]          ONE_WEEK … ONE_YEAR; needed only to create it
 * @property {string} [group]           group reference name; the app's first group when omitted
 * @property {number} [groupLevel]
 * @property {boolean} [familySharable]
 * @property {string} [reviewNote]
 * @property {string} [groupDisplayName]
 * @property {string} [localeName]
 * @property {string} [localeDescription]
 * @property {Record<string, {name?: string, description?: string, groupName?: string}>} [localizations]
 * @property {string} priceTerritory
 * @property {number} [priceAmount]
 * @property {string} [reviewScreenshot]
 * @property {{ type: "FREE_TRIAL"|"PAY_AS_YOU_GO"|"PAY_UP_FRONT", duration: string, periods?: number, priceAmount?: number }} [introOffer]
 */

/**
 * @typedef {Object} PurchaseConfig
 * @property {string} productId
 * @property {string} [name]
 * @property {"NON_CONSUMABLE"|"CONSUMABLE"|"NON_RENEWING_SUBSCRIPTION"} type
 * @property {boolean} [familySharable]
 * @property {string} [reviewNote]
 * @property {string} [localeName]
 * @property {string} [localeDescription]
 * @property {Record<string, {name?: string, description?: string}>} [localizations]
 * @property {string} priceTerritory
 * @property {number} [priceAmount]
 * @property {string} [reviewScreenshot]
 */

/** @param {any} config @returns {SubscriptionConfig[]} */
export function subscriptionConfigs(config) {
  const list = Array.isArray(config?.subscriptions)
    ? config.subscriptions
    : config?.subscription
      ? [config.subscription]
      : [];
  return list.filter((s) => s && s.productId).map((s) => ({ ...s, priceTerritory: s.priceTerritory ?? "USA" }));
}

/** @param {any} config @returns {PurchaseConfig[]} */
export function purchaseConfigs(config) {
  return (Array.isArray(config?.inAppPurchases) ? config.inAppPurchases : [])
    .filter((p) => p && p.productId)
    .map((p) => ({ ...p, type: p.type ?? "NON_CONSUMABLE", priceTerritory: p.priceTerritory ?? "USA" }));
}

/**
 * Per-locale texts: the flat fields for the config's locale, then each entry of
 * `localizations`, inheriting what it leaves out.
 *
 * @param {{ localeName?: string, localeDescription?: string, groupDisplayName?: string, localizations?: Record<string, any> }} product
 * @param {string} primary
 * @returns {Array<{ locale: string, name?: string, description?: string, groupName?: string }>}
 */
export function productTexts(product, primary) {
  const base = {
    name: product.localeName,
    description: product.localeDescription,
    groupName: product.groupDisplayName,
  };
  const out = [{ locale: primary, ...base }];
  for (const [locale, t] of Object.entries(product.localizations ?? {})) {
    const entry = { locale, ...base, ...(t ?? {}) };
    const i = out.findIndex((e) => e.locale === locale);
    if (i === -1) out.push(entry);
    else out[i] = entry;
  }
  return out;
}

/**
 * What a product needs before App Review will take it. Missing fields are
 * reported per product, by name, instead of failing the whole pipeline — an app
 * with no subscriptions configured simply has nothing to check here.
 *
 * @param {SubscriptionConfig|PurchaseConfig} product
 * @param {"subscriptions"|"inAppPurchases"} kind
 * @param {number} index
 */
export function missingProductFields(product, kind, index) {
  const required = ["priceAmount", "reviewScreenshot", "localeName"];
  return required
    .filter((field) => product[/** @type {keyof typeof product} */ (field)] == null)
    .map((field) =>
      finding({
        id: `config.${kind}.${product.productId}.${field}.missing`,
        category: Category.CONFIG,
        title: `${product.productId} has no ${field}`,
        detail: `App Review needs it before ${product.productId} can leave MISSING_METADATA.`,
        fixOwner: FixOwner.CLI,
        fix: `Set ${kind}[${index}].${field} in your config.`,
      }),
    );
}

/** States a product only reaches after Apple has approved it once. */
const SHIPPED_STATES = ["APPROVED", "DEVELOPER_REMOVED_FROM_SALE", "REMOVED_FROM_SALE"];

/**
 * Apple sends an app's FIRST subscription — and its first in-app purchase — to
 * review together with the binary, from appstoreconnect.apple.com. Later ones
 * go through the API.
 *
 * @param {Array<{ state?: string, attributes?: { state?: string } }>} products  every product of that kind
 */
export const isFirstProduct = (products) =>
  !products.some((p) => SHIPPED_STATES.includes(p.state ?? p.attributes?.state ?? ""));
