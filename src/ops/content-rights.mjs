// Declares whether the app uses third-party content (required before submission).
import { Status } from "../core/status.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "content-rights",
  title: "Content rights",
  phase: "listing",
  needs: [],
  mutates: true,
};

export async function run({ client, discovery, config }) {
  const value = config?.contentRights || "DOES_NOT_USE_THIRD_PARTY_CONTENT";
  const app = await discovery.app();
  if (app.attributes.contentRightsDeclaration === value) return { status: Status.OK, message: value };

  await client.patch(`/v1/apps/${discovery.appId}`, {
    data: { type: "apps", id: discovery.appId, attributes: { contentRightsDeclaration: value } },
  });
  return { status: Status.CHANGED, message: value };
}
