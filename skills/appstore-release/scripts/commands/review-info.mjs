// Sets the App Review contact info (and optional demo account) on the version.
import { Status } from "../lib/log.mjs";

export const meta = { id: "review-info", title: "App Review info", phase: "listing", needs: ["review"] };

export async function run({ client, discovery, config }) {
  const r = config?.review;
  if (!r) return { status: Status.ERROR, message: "config.review is required" };

  const version = await discovery.editableVersion();
  const attributes = {
    contactFirstName: r.contactFirstName,
    contactLastName: r.contactLastName,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    demoAccountRequired: !!r.demoAccountRequired,
    demoAccountName: r.demoAccountName || "",
    demoAccountPassword: r.demoAccountPassword || "",
    notes: r.notes || "",
  };

  const existing = await client.get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`, { throwOnError: false });
  if (!existing.error && existing.data) {
    await client.patch(`/v1/appStoreReviewDetails/${existing.data.id}`, {
      data: { type: "appStoreReviewDetails", id: existing.data.id, attributes },
    });
  } else {
    await client.post(`/v1/appStoreReviewDetails`, {
      data: {
        type: "appStoreReviewDetails",
        attributes,
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
      },
    });
  }
  return { status: Status.CHANGED, message: `${r.contactFirstName} ${r.contactLastName}` };
}
