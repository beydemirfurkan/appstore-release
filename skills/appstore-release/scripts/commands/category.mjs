// Sets the app's primary (+ optional secondary) App Store category.
import { Status } from "../lib/log.mjs";

export const meta = { id: "category", title: "Category", phase: "listing", needs: ["category"] };

export async function run({ client, discovery, config }) {
  const primary = config?.category?.primary;
  if (!primary) return { status: Status.ERROR, message: "config.category.primary is required" };
  const secondary = config.category.secondary || null;

  const { info } = await discovery.appInfo();
  const curPrimary = info?.relationships?.primaryCategory?.data?.id || null;
  const curSecondary = info?.relationships?.secondaryCategory?.data?.id || null;
  const label = `${primary}${secondary ? "/" + secondary : ""}`;
  if (curPrimary === primary && curSecondary === secondary) return { status: Status.OK, message: label };

  const relationships = { primaryCategory: { data: { type: "appCategories", id: primary } } };
  if (secondary) relationships.secondaryCategory = { data: { type: "appCategories", id: secondary } };
  await client.patch(`/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships } });
  return { status: Status.CHANGED, message: label };
}
