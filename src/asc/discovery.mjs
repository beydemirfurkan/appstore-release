// Resource discovery / repository. Single responsibility: locate ASC resources for
// an app by their natural keys so commands never hardcode ids. Depends only on AscClient.

const EDITABLE_STATES = [
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
];

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

  /** The version we can edit/submit (prefers one already in an editable state). */
  editableVersion() {
    return this._once("editableVersion", async () => {
      const r = await this.client.get(
        `/v1/apps/${this.appId}/appStoreVersions?limit=10&fields[appStoreVersions]=versionString,appStoreState,platform`
      );
      return r.data.find((v) => EDITABLE_STATES.includes(v.attributes.appStoreState)) || r.data[0];
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
        `/v1/apps/${this.appId}/appInfos?include=primaryCategory,secondaryCategory,ageRatingDeclaration`
      );
      const info =
        r.data.find((i) => ["PREPARE_FOR_SUBMISSION", "READY_FOR_DISTRIBUTION"].includes(i.attributes.appStoreState)) ||
        r.data[0];
      return { info, included: r.included || [] };
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
      `/v1/builds?filter[app]=${this.appId}${vf}&limit=1&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate`
    );
    return r.data[0];
  }

  /** Newest VALID build (ready to attach). */
  async latestValidBuild() {
    const r = await this.client.get(
      `/v1/builds?filter[app]=${this.appId}&filter[processingState]=VALID&limit=1&sort=-uploadedDate&fields[builds]=version`
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
