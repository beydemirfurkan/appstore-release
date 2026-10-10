// Version copyright, and the app's price schedule.
//
// Apple takes a price *point* id rather than an amount, and a new app is refused
// at "Add for Review" without a schedule — even a free one. Paid tiers used to be
// unimplemented, so a paid app could not be released through this tool at all.

import { Status } from "../core/status.mjs";
import { nearestPricePoint, resolvePrice } from "../core/price.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "pricing",
  title: "Pricing + copyright",
  phase: "listing",
  needs: ["pricing"],
  mutates: true,
};

/** @param {import("../core/context.mjs").Context} ctx */
export async function run({ client, discovery, config }) {
  const version = await discovery.editableVersion();
  const changes = [];

  const copyright = config?.metadata?.copyright;
  if (copyright) {
    const vfull = (await client.get(`/v1/appStoreVersions/${version.id}?fields[appStoreVersions]=copyright`)).data;
    if (vfull.attributes.copyright !== copyright) {
      await client.patch(`/v1/appStoreVersions/${version.id}`, {
        data: { type: "appStoreVersions", id: version.id, attributes: { copyright } },
      });
      changes.push("copyright");
    }
  }

  const price = resolvePrice(config?.price);
  if (price) {
    const existing = await client.get(
      `/v1/appPriceSchedules/${discovery.appId}/manualPrices?filter[territory]=${price.baseTerritory}` +
        `&include=appPricePoint&fields[appPrices]=startDate,endDate,appPricePoint&limit=50`,
      { throwOnError: false },
    );
    const manual = existing.error ? [] : (existing.data ?? []);
    const hasSchedule = manual.length > 0;
    // The price in effect now — not whichever entry came back first, which could
    // be a scheduled change or one that already ended.
    const now = Date.now();
    const inEffect = manual.find(
      (p) =>
        (!p.attributes?.startDate || Date.parse(p.attributes.startDate) <= now) &&
        (!p.attributes?.endDate || Date.parse(p.attributes.endDate) > now),
    );

    const points = await client.all(
      `/v1/apps/${discovery.appId}/appPricePoints?filter[territory]=${price.baseTerritory}`,
      { limit: 200 },
    );
    const target = price.free ? nearestPricePoint(points, 0) : nearestPricePoint(points, price.amount);

    if (!target) {
      return {
        status: Status.ERROR,
        message: `no price points available for ${price.baseTerritory}`,
      };
    }
    // Say so rather than silently charging a different amount than asked.
    const nearestNote =
      !price.free && Math.abs(target.customerPrice - price.amount) > 0.01 ? ` (nearest to ${price.amount})` : "";

    // Already on the right price point? Then there is nothing to do — replacing
    // an identical schedule would make every run report a change.
    const currentPointId = inEffect?.relationships?.appPricePoint?.data?.id;
    if (!(hasSchedule && currentPointId === target.id)) {
      await client.post(`/v1/appPriceSchedules`, {
        data: {
          type: "appPriceSchedules",
          relationships: {
            app: { data: { type: "apps", id: discovery.appId } },
            baseTerritory: { data: { type: "territories", id: price.baseTerritory } },
            manualPrices: { data: [{ type: "appPrices", id: "${p1}" }] },
          },
        },
        included: [
          {
            type: "appPrices",
            id: "${p1}",
            attributes: { startDate: null },
            relationships: { appPricePoint: { data: { type: "appPricePoints", id: target.id } } },
          },
        ],
      });
      changes.push(price.free ? "free price" : `price ${target.customerPrice} ${price.baseTerritory}${nearestNote}`);
    }
  }

  if (!changes.length) return { status: Status.OK, message: "copyright + price already set" };
  return { status: Status.CHANGED, message: changes.join(" + ") };
}
