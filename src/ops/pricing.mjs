// Sets the version copyright and, for free apps, the Free price tier (which also
// fills territory availability). Idempotent: skips whatever is already correct.
import { Status } from "../core/log.mjs";

export const meta = { id: "pricing", title: "Pricing + copyright", phase: "listing", needs: ["pricing"] };

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

  if (config?.price === "free") {
    const existing = await client.get(`/v1/appPriceSchedules/${discovery.appId}/manualPrices?limit=1`, {
      throwOnError: false,
    });
    const hasPrice = !existing.error && (existing.data || []).length > 0;
    if (!hasPrice) {
      const pp = await client.get(`/v1/apps/${discovery.appId}/appPricePoints?filter[territory]=USA&limit=200`);
      const free = (pp.data || []).find((d) => parseFloat(d.attributes.customerPrice) === 0);
      if (!free) return { status: Status.ERROR, message: "free price point not found for USA" };
      await client.post(`/v1/appPriceSchedules`, {
        data: {
          type: "appPriceSchedules",
          relationships: {
            app: { data: { type: "apps", id: discovery.appId } },
            baseTerritory: { data: { type: "territories", id: "USA" } },
            manualPrices: { data: [{ type: "appPrices", id: "${p1}" }] },
          },
        },
        included: [
          {
            type: "appPrices",
            id: "${p1}",
            attributes: { startDate: null },
            relationships: { appPricePoint: { data: { type: "appPricePoints", id: free.id } } },
          },
        ],
      });
      changes.push("free price");
    }
  }

  if (!changes.length) return { status: Status.OK, message: "copyright + price already set" };
  return { status: Status.CHANGED, message: changes.join(" + ") };
}
