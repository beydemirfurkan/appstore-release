// Reports whether the editable version is ready to submit, then records the two
// UI-only steps Apple exposes no API for (App Privacy; first-time subscription).
import { Status } from "../lib/log.mjs";

export const meta = { id: "check", title: "Readiness check", phase: "listing", needs: [] };

export async function run({ client, discovery, config, log }) {
  const version = await discovery.editableVersion();
  const vfull = (
    await client.get(`/v1/appStoreVersions/${version.id}?fields[appStoreVersions]=versionString,appStoreState,copyright`)
  ).data;

  log.section(`Readiness — v${vfull.attributes.versionString} (${vfull.attributes.appStoreState})`);
  const mark = (ok, label, extra = "") => log.info(`${ok ? "✓" : "✗"} ${label}${extra ? " (" + extra + ")" : ""}`);

  const build = await discovery.attachedBuild(version.id);
  mark(!!build, "Build attached", build?.attributes?.version || "");
  mark(!!vfull.attributes.copyright, "Copyright", vfull.attributes.copyright || "");

  const app = await discovery.app();
  mark(!!app.attributes.contentRightsDeclaration, "Content rights", app.attributes.contentRightsDeclaration || "");

  const { info } = await discovery.appInfo();
  mark(!!info?.relationships?.primaryCategory?.data, "Category", info?.relationships?.primaryCategory?.data?.id || "");
  mark(!!info?.relationships?.ageRatingDeclaration?.data, "Age rating");

  const locale = config?.locale;
  if (locale) {
    const verLoc = (await client.get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)).data.find(
      (l) => l.attributes.locale === locale
    );
    if (verLoc) {
      const la = (
        await client.get(`/v1/appStoreVersionLocalizations/${verLoc.id}?fields[appStoreVersionLocalizations]=description,keywords,supportUrl`)
      ).data.attributes;
      mark(!!la.description, "Description");
      mark(!!la.keywords, "Keywords");
      mark(!!la.supportUrl, "Support URL");

      const sets = await client.get(`/v1/appStoreVersionLocalizations/${verLoc.id}/appScreenshotSets?include=appScreenshots`);
      let total = 0, complete = 0;
      for (const s of sets.data) {
        const shots = (sets.included || []).filter(
          (x) => x.type === "appScreenshots" && (s.relationships?.appScreenshots?.data || []).some((d) => d.id === x.id)
        );
        total += shots.length;
        complete += shots.filter((x) => x.attributes.assetDeliveryState?.state === "COMPLETE").length;
      }
      mark(total > 0 && complete === total, "Screenshots", `${complete}/${total} COMPLETE`);
    }
  }

  const price = await client.get(`/v1/appPriceSchedules/${discovery.appId}/manualPrices?limit=1`, { throwOnError: false });
  mark(!price.error && (price.data || []).length > 0, "Price tier set");

  let subReadyToSubmit = false;
  const productId = config?.subscription?.productId;
  if (productId) {
    const { sub } = await discovery.subscription(productId);
    mark(sub && sub.attributes.state !== "MISSING_METADATA", `Subscription ${productId}`, sub?.attributes?.state || "not found");
    subReadyToSubmit = sub?.attributes?.state === "READY_TO_SUBMIT";
  }

  // The two steps Apple keeps UI-only.
  log.result({
    id: "app-privacy",
    title: "App Privacy (data collection)",
    status: Status.MANUAL,
    message: "declare data types matching the privacy manifest, then Publish — ASC UI, no API",
  });
  if (subReadyToSubmit) {
    log.result({
      id: "first-subscription",
      title: "First subscription",
      status: Status.MANUAL,
      message: "attach to the version + submit in the ASC UI (version page → In-App Purchases and Subscriptions → Select → Save → Add for Review → Submit)",
    });
  }

  return { status: Status.OK, message: `v${vfull.attributes.versionString}` };
}
