// Uploads the textual store listing for the configured locale.
// App Info: name, subtitle, privacy policy URL.  Version: description, keywords,
// promotional text, support/marketing URLs, (whatsNew only for non-first versions).
import { Status } from "../core/log.mjs";
import { validateConfig } from "../core/config.mjs";

export const meta = { id: "metadata", title: "Store metadata", phase: "listing", needs: ["metadata"] };

export async function run({ discovery, client, config }) {
  const { valid, missing } = validateConfig(config, { needs: ["metadata"] });
  if (!valid) return { status: Status.ERROR, message: `config missing: ${missing.join(", ")}` };

  const locale = config.locale;
  const m = config.metadata;

  // App Info localization: name / subtitle / privacy policy URL
  const { info } = await discovery.appInfo();
  const infoLoc = await discovery.appInfoLocalization(info.id, locale);
  await client.patch(`/v1/appInfoLocalizations/${infoLoc.id}`, {
    data: {
      type: "appInfoLocalizations",
      id: infoLoc.id,
      attributes: { name: m.name, subtitle: m.subtitle, privacyPolicyUrl: m.privacyPolicyUrl },
    },
  });

  // Version localization: description / keywords / promo / URLs
  const version = await discovery.editableVersion();
  const verLoc = await discovery.versionLocalization(version.id, locale);
  const attributes = {
    description: m.description,
    keywords: m.keywords,
    promotionalText: m.promotionalText,
    supportUrl: m.supportUrl,
    marketingUrl: m.marketingUrl,
  };
  // whatsNew is only editable on updates, not the first submission.
  const isFirst = version.attributes.versionString === "1.0" || version.attributes.appStoreState === "PREPARE_FOR_SUBMISSION";
  if (m.whatsNew && !isFirst) attributes.whatsNew = m.whatsNew;

  await client.patch(`/v1/appStoreVersionLocalizations/${verLoc.id}`, {
    data: { type: "appStoreVersionLocalizations", id: verLoc.id, attributes },
  });

  return { status: Status.CHANGED, message: `${locale}: name, subtitle, description, keywords, URLs` };
}
