// Sets the app's primary (+ optional secondary) App Store category.
import { Status } from "../core/status.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "category",
  title: "Category",
  phase: "listing",
  needs: ["category"],
  mutates: true,
};

export async function run({ client, discovery, config }) {
  const primary = config?.category?.primary;
  if (!primary) return { status: Status.ERROR, message: "config.category.primary is required" };
  const secondary = config.category.secondary || null;

  const { info } = await discovery.appInfo();
  const curPrimary = info?.relationships?.primaryCategory?.data?.id || null;
  const curSecondary = info?.relationships?.secondaryCategory?.data?.id || null;
  const label = `${primary}${secondary ? "/" + secondary : ""}`;
  if (curPrimary === primary && curSecondary === secondary) return { status: Status.OK, message: label };

  // A secondary removed from the config is cleared, not left behind — otherwise
  // the two never match again and every run PATCHes and reports a change.
  const relationships = {
    primaryCategory: { data: { type: "appCategories", id: primary } },
    secondaryCategory: { data: secondary ? { type: "appCategories", id: secondary } : null },
  };
  await client.patch(`/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships } });
  return { status: Status.CHANGED, message: label };
}
