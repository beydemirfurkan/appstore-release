// The textual store listing for the configured locale.
//
// Apple splits these fields across two resources and the split is not obvious:
// name, subtitle and the privacy policy URL live on appInfoLocalizations, while
// description, keywords, promotional text and the support/marketing URLs live on
// appStoreVersionLocalizations. Getting it wrong returns a 409 naming a field
// that does look like it should be there.

import { Status } from "../core/status.mjs";
import { resolveLocales } from "../core/locales.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "metadata",
  title: "Store metadata",
  phase: "listing",
  needs: ["metadata"],
  mutates: true,
};

const APP_INFO_FIELDS = ["name", "subtitle", "privacyPolicyUrl"];
const VERSION_FIELDS = ["description", "keywords", "promotionalText", "supportUrl", "marketingUrl"];

// runOperation validates `meta.needs` before we get here, so config.metadata and
// config.locale are guaranteed present — no defensive re-check.
/** @param {import("../core/context.mjs").Context} ctx */
export async function run({ discovery, client, config }) {
  const locales = resolveLocales(config);
  const { info } = await discovery.appInfo();
  const version = await discovery.editableVersion();
  // Asked once rather than once per locale: it is a property of the app.
  const firstEver = await isFirstEverVersion(client, discovery, version);

  /** @type {Record<string, string[]>} */
  const changedByLocale = {};

  for (const { locale, metadata: m } of locales) {
    const changed = [];

    // App Info localization: name / subtitle / privacy policy URL
    const infoLoc = await discovery.appInfoLocalization(info.id, locale);
    const infoCurrent = await readAttributes(client, `/v1/appInfoLocalizations/${infoLoc.id}`, APP_INFO_FIELDS);
    const infoDiff = diff(infoCurrent, pick(m, APP_INFO_FIELDS));
    if (Object.keys(infoDiff).length) {
      await client.patch(`/v1/appInfoLocalizations/${infoLoc.id}`, {
        data: { type: "appInfoLocalizations", id: infoLoc.id, attributes: infoDiff },
      });
      changed.push(...Object.keys(infoDiff));
    }

    // Version localization: description / keywords / promo / URLs
    const verLoc = await discovery.versionLocalization(version.id, locale);
    const wanted = pick(m, VERSION_FIELDS);

    // whatsNew is rejected on a genuinely first submission with 409 STATE_ERROR.
    // "First" means the app has never had another version — not merely that this
    // one is in PREPARE_FOR_SUBMISSION, which every unsubmitted update also is.
    if (m.whatsNew && !firstEver) wanted.whatsNew = m.whatsNew;

    const verCurrent = await readAttributes(client, `/v1/appStoreVersionLocalizations/${verLoc.id}`, [
      ...VERSION_FIELDS,
      "whatsNew",
    ]);
    const verDiff = diff(verCurrent, wanted);
    if (Object.keys(verDiff).length) {
      await client.patch(`/v1/appStoreVersionLocalizations/${verLoc.id}`, {
        data: { type: "appStoreVersionLocalizations", id: verLoc.id, attributes: verDiff },
      });
      changed.push(...Object.keys(verDiff));
    }

    if (changed.length) changedByLocale[locale] = changed;
  }

  const touched = Object.keys(changedByLocale);
  const scope = locales.length === 1 ? locales[0].locale : `${locales.length} locales`;
  if (!touched.length)
    return { status: Status.OK, message: `${scope}: already up to date`, details: { locales: localeCodesOf(locales) } };

  return {
    status: Status.CHANGED,
    message: touched.map((l) => `${l}: ${changedByLocale[l].join(", ")}`).join(" · "),
    details: { locales: localeCodesOf(locales), changed: changedByLocale },
  };
}

const localeCodesOf = (locales) => locales.map((l) => l.locale);

/** Read only the fields we are about to consider writing. */
async function readAttributes(client, path, fields) {
  const resource = path.split("/")[2];
  const res = await client.get(`${path}?fields[${resource}]=${fields.join(",")}`, { throwOnError: false });
  return res.error ? {} : (res.data?.attributes ?? {});
}

const pick = (source, fields) =>
  Object.fromEntries(fields.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));

/** Only the fields whose value would actually change. */
function diff(current, wanted) {
  const out = {};
  for (const [key, value] of Object.entries(wanted)) {
    if ((current[key] ?? "") !== (value ?? "")) out[key] = value;
  }
  return out;
}

/** True when this app has never had any other version. */
async function isFirstEverVersion(client, discovery, version) {
  const all = await client.all(`/v1/apps/${discovery.appId}/appStoreVersions?fields[appStoreVersions]=versionString`, {
    limit: 50,
  });
  return all.filter((v) => v.id !== version.id).length === 0;
}
