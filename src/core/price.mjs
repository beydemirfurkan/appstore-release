// Apple does not take a price; it takes a price *point*, an opaque id per
// territory. So "4.99" means "whichever price point is nearest 4.99 in the base
// territory". The same rule applies to apps and to subscriptions, and it was
// implemented once inside the subscription operation.

/**
 * @typedef {Object} PricePoint
 * @property {string} id
 * @property {number} customerPrice
 */

/**
 * The price point closest to a target amount.
 *
 * @param {Array<{id: string, attributes: {customerPrice: string|number}}>} points
 * @param {number} amount
 * @returns {PricePoint|null}
 */
export function nearestPricePoint(points, amount) {
  const parsed = (points ?? [])
    .map((d) => ({ id: d.id, customerPrice: Number.parseFloat(String(d.attributes?.customerPrice)) }))
    .filter((p) => Number.isFinite(p.customerPrice));
  if (!parsed.length) return null;
  return parsed.reduce((best, c) =>
    Math.abs(c.customerPrice - amount) < Math.abs(best.customerPrice - amount) ? c : best,
  );
}

/**
 * Normalize the price config. `"free"` is the shorthand everything already used;
 * an object names an amount and the territory it is quoted in.
 *
 * @param {any} price   config.price
 * @returns {{ free: boolean, amount: number, baseTerritory: string }|null}
 */
export function resolvePrice(price) {
  if (price == null) return null;
  if (price === "free") return { free: true, amount: 0, baseTerritory: "USA" };
  if (typeof price === "object") {
    const amount = Number(price.amount);
    if (!Number.isFinite(amount)) return null;
    return { free: amount === 0, amount, baseTerritory: price.baseTerritory ?? "USA" };
  }
  return null;
}
