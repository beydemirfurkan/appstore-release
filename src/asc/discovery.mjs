// Resource discovery / repository. Single responsibility: locate ASC resources for
// an app by their natural keys so commands never hardcode ids. Depends only on AscClient.

import { VersionStates, pickEditableAppInfo } from "../core/status.mjs";

export class Discovery {
  /**
   * @param {import("./client.mjs").AscClient} client
   * @param {string} appId
   */
  constructor(client, appId) {
    this.client = client;
    this.appId = appId;
    this._cache = new Map();
  }

  async _once(key, fn) {
    if (!this._cache.has(key)) this._cache.set(key, await fn());
    return this._cache.get(key);
  }

  app() {
    return this._once("app", async () => (await this.client.get(`/v1/apps/${this.appId}`)).data);
  }

  /**
   * The iOS version we can edit and submit. Throws rather than falling back to
   * whatever came first: writing a live version's listing is never what anyone
   * meant, and the operation runner turns the throw into a clear ERROR result.
   */
  editableVersion() {
    return this._once("editableVersion", async () => {
      const versions = await this.client.all(
        `/v1/apps/${this.appId}/appStoreVersions?filter[platform]=IOS&fields[appStoreVersions]=versionString,appStoreState,platform`,
        { limit: 50 },
      );
      const editable = versions.find((v) => VersionStates.EDITABLE.includes(v.attributes.appStoreState));
      if (editable) return editable;
      const inFlight = versions.find((v) => VersionStates.IN_FLIGHT.includes(v.attributes.appStoreState));
      throw new Error(
        inFlight
          ? `v${inFlight.attributes.versionString} is ${inFlight.attributes.appStoreState} and cannot be edited`
          : "no editable version — every version is live; run `appstore-release new-version` first",
      );
    });
  }

  /** Find-or-create the version localization for a locale. */
  async versionLocalization(versionId, locale) {
    const r = await this.client.get(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`);
    const found = r.data.find((l) => l.attributes.locale === locale);
    if (found) return found;
    return (
      await this.client.post(`/v1/appStoreVersionLocalizations`, {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: { locale },
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
        },
      })
    ).data;
  }

  /** The editable App Info (holds name/subtitle/privacy URL, category, age rating). */
  appInfo() {
    return this._once("appInfo", async () => {
      const r = await this.client.get(
        `/v1/apps/${this.appId}/appInfos?include=primaryCategory,secondaryCategory,ageRatingDeclaration`,
      );
      return { info: pickEditableAppInfo(r.data), included: r.included || [] };
    });
  }

  /** Find-or-create the App Info localization for a locale. */
  async appInfoLocalization(appInfoId, locale) {
    const r = await this.client.get(`/v1/appInfos/${appInfoId}/appInfoLocalizations?limit=50`);
    const found = r.data.find((l) => l.attributes.locale === locale);
    if (found) return found;
    return (
      await this.client.post(`/v1/appInfoLocalizations`, {
        data: {
          type: "appInfoLocalizations",
          attributes: { locale },
          relationships: { appInfo: { data: { type: "appInfos", id: appInfoId } } },
        },
      })
    ).data;
  }

  async bundleId(identifier) {
    const r = await this.client.get(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=1`);
    return r.data[0];
  }

  /** Latest uploaded build, optionally filtered to a specific build number. */
  async latestBuild(versionFilter) {
    const vf = versionFilter ? `&filter[version]=${versionFilter}` : "";
    const r = await this.client.get(
      `/v1/builds?filter[app]=${this.appId}${vf}&limit=1&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate`,
    );
    return r.data[0];
  }

  /**
   * Newest VALID, unexpired iOS build for a marketing version. A build uploaded
   * for 1.3 is not attachable to 1.2 — Apple matches CFBundleShortVersionString —
   * so without the version filter "newest" could pick one Apple then refuses.
   *
   * @param {string} [versionString]
   */
  async latestValidBuild(versionString) {
    const vf = versionString ? `&filter[preReleaseVersion.version]=${encodeURIComponent(versionString)}` : "";
    const r = await this.client.get(
      `/v1/builds?filter[app]=${this.appId}&filter[processingState]=VALID&filter[expired]=false` +
        `&filter[preReleaseVersion.platform]=IOS${vf}&limit=1&sort=-uploadedDate&fields[builds]=version,processingState`,
    );
    return r.data[0];
  }

  /** The build currently attached to a version (relationship endpoint; collection include doesn't resolve it). */
  async attachedBuild(versionId) {
    const r = await this.client.get(`/v1/appStoreVersions/${versionId}/build?fields[builds]=version`, {
      throwOnError: false,
    });
    return r.error ? null : r.data;
  }

  /** A subscription (by productId, else the first) plus its group. */
  async subscription(productId) {
    const groups = await this.client.get(`/v1/apps/${this.appId}/subscriptionGroups?include=subscriptions&limit=25`);
    const subs = (groups.included || []).filter((x) => x.type === "subscriptions");
    const sub = productId ? subs.find((s) => s.attributes.productId === productId) : subs[0];
    const group =
      groups.data.find((g) => (g.relationships?.subscriptions?.data || []).some((d) => d.id === sub?.id)) ||
      groups.data[0];
    return { group, sub, all: subs };
  }
}
