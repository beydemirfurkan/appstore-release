// Read-only overview of the app's ASC state. Reports via ctx.log; mutates nothing.
import { Status } from "../lib/log.mjs";

export const meta = { id: "status", title: "Status", phase: "listing", needs: [] };

export async function run({ client, discovery, log }) {
  const appId = discovery.appId;
  const app = await discovery.app();

  log.section("App");
  log.info(`${app.attributes.name} • ${app.attributes.bundleId} • SKU ${app.attributes.sku} • ${app.attributes.primaryLocale}`);
  log.info(`content rights: ${app.attributes.contentRightsDeclaration || "not set"}`);

  log.section("Builds");
  const builds = await client.get(
    `/v1/builds?filter[app]=${appId}&limit=6&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate,expired`
  );
  if (!builds.data.length) log.info("(none)");
  for (const b of builds.data)
    log.info(`build ${b.attributes.version} • ${b.attributes.processingState}${b.attributes.expired ? " • EXPIRED" : ""} • ${b.attributes.uploadedDate?.slice(0, 10)}`);

  log.section("App Store versions");
  const versions = await client.get(
    `/v1/apps/${appId}/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState,copyright`
  );
  for (const v of versions.data) {
    const attached = await discovery.attachedBuild(v.id);
    log.info(
      `v${v.attributes.versionString} • ${v.attributes.appStoreState} • copyright:${v.attributes.copyright ? "yes" : "no"} • build:${attached?.attributes?.version || "none"}`
    );
  }

  log.section("Screenshots (editable version)");
  const version = await discovery.editableVersion();
  const locs = await client.get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  for (const l of locs.data) {
    const sets = await client.get(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?include=appScreenshots`);
    for (const s of sets.data) {
      const shots = (sets.included || []).filter(
        (x) => x.type === "appScreenshots" && (s.relationships?.appScreenshots?.data || []).some((d) => d.id === x.id)
      );
      log.info(
        `${l.attributes.locale} • ${s.attributes.screenshotDisplayType} • ${shots.length} • ${shots.map((x) => x.attributes.assetDeliveryState?.state).join(",") || "-"}`
      );
    }
  }

  log.section("Category + age rating");
  const { info } = await discovery.appInfo();
  log.info(`primary:${info?.relationships?.primaryCategory?.data?.id || "none"} • secondary:${info?.relationships?.secondaryCategory?.data?.id || "-"}`);
  log.info(`age rating declaration: ${info?.relationships?.ageRatingDeclaration?.data ? "present" : "none"}`);

  log.section("Subscriptions");
  const { all } = await discovery.subscription();
  if (!all.length) log.info("(none)");
  for (const s of all) log.info(`${s.attributes.name} • ${s.attributes.productId} • ${s.attributes.subscriptionPeriod} • ${s.attributes.state}`);

  log.section("Certificates + profiles");
  const certs = await client.get(`/v1/certificates?limit=20`);
  for (const c of certs.data)
    log.info(`${c.attributes.certificateType} • ${c.attributes.displayName || c.attributes.name} • exp:${c.attributes.expirationDate?.slice(0, 10)}`);
  const profiles = await client.get(`/v1/profiles?limit=30&fields[profiles]=name,profileType,profileState,expirationDate`);
  const mine = profiles.data.filter((p) => (p.attributes.name || "").includes(app.attributes.bundleId));
  for (const p of (mine.length ? mine : profiles.data.slice(0, 6)))
    log.info(`${p.attributes.name} • ${p.attributes.profileType} • ${p.attributes.profileState} • exp:${p.attributes.expirationDate?.slice(0, 10)}`);

  return { status: Status.OK, message: app.attributes.name };
}
