// Sets the App Review contact info (and optional demo account) on the version.
import { Status } from "../core/status.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "review-info",
  title: "App Review info",
  phase: "listing",
  needs: ["review"],
  mutates: true,
};

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
  const label = `${r.contactFirstName} ${r.contactLastName}`;
  if (!existing.error && existing.data) {
    // Only what differs is sent, so an unchanged config is a true no-op. Apple
    // returns null for an empty string, hence the normalisation.
    const current = existing.data.attributes ?? {};
    const diff = Object.fromEntries(
      Object.entries(attributes).filter(([k, v]) => (current[k] ?? (typeof v === "boolean" ? false : "")) !== v),
    );
    if (!Object.keys(diff).length) return { status: Status.OK, message: label };
    await client.patch(`/v1/appStoreReviewDetails/${existing.data.id}`, {
      data: { type: "appStoreReviewDetails", id: existing.data.id, attributes: diff },
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
  return { status: Status.CHANGED, message: label };
}
