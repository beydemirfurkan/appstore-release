// The textual listing for the locale being prepared.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";

export const section = { id: "metadata", title: "Store metadata" };

const REQUIRED = [
  ["description", "Description"],
  ["keywords", "Keywords"],
  ["supportUrl", "Support URL"],
];

/** @param {{ snapshot: any, config: any }} input */
export function check({ snapshot, config }) {
  const out = [];
  if (!snapshot.version) return out;

  const wanted = snapshot.locales?.length ? snapshot.locales : snapshot.locale ? [snapshot.locale] : [];
  const detailed = snapshot.localizations.filter((l) => l.detailed);
  const multi = wanted.length > 1;
  /** Name the finding after the locale only when there is more than one. */
  const suffix = (locale) => (multi ? `.${locale}` : "");

  for (const locale of wanted) {
    const loc = detailed.find((l) => l.attributes?.locale === locale);
    if (!loc) {
      out.push(
        finding({
          id: `metadata.locale.missing${suffix(locale)}`,
          category: Category.ASC_STATE,
          title: `No localization for ${locale}`,
          detail: "The version has no localization for this configured locale.",
          fix: "Run the metadata operation; it creates the localization if it is absent.",
          fixCommand: "appstore-release metadata",
        }),
      );
      continue;
    }

    for (const [field, label] of REQUIRED) {
      if (loc.attributes?.[field]) continue;
      out.push(
        finding({
          id: `metadata.${field}.missing${suffix(locale)}`,
          category: Category.ASC_STATE,
          title: multi ? `${label} is empty for ${locale}` : `${label} is empty`,
          detail: `appStoreVersionLocalizations.${field} is not set for ${locale}.`,
          fix: multi
            ? `Set locales.${locale}.${field} (or metadata.${field} to share it) and run metadata.`
            : `Set metadata.${field} in your config and run metadata.`,
          fixCommand: "appstore-release metadata",
          evidence: { resource: "appStoreVersionLocalizations", id: loc.id, actual: locale },
        }),
      );
    }
  }

  const loc = detailed[0];
  if (!loc) return out;

  // whatsNew is rejected outright on a first version; carrying it in the config
  // is the difference between a clean run and a 409 nobody expects.
  const isFirst = snapshot.version.attributes.versionString === "1.0" || (snapshot.versions?.length ?? 0) <= 1;
  if (isFirst && config?.metadata?.whatsNew) {
    out.push(
      finding({
        id: "metadata.whatsNew.first-version",
        severity: Severity.WARNING,
        category: Category.CONFIG,
        title: "whatsNew is set on a first version",
        detail: "App Store Connect returns 409 STATE_ERROR: attribute 'whatsNew' cannot be edited on a first release.",
        fix: "Remove metadata.whatsNew from the config until the first update.",
        docs: "references/gotchas.md#metadata",
      }),
    );
  }

  // Locales that exist in App Store Connect but the config says nothing about.
  // We will not touch them, so say so rather than let them look accounted for.
  const unmanaged = snapshot.localizations.filter((l) => !l.detailed);
  if (unmanaged.length) {
    out.push(
      finding({
        id: "metadata.locale.unmanaged",
        severity: Severity.INFO,
        category: Category.ASC_STATE,
        title: `${unmanaged.length} locale(s) on this version are not in your config`,
        detail: `Not checked or written: ${unmanaged.map((l) => l.attributes.locale).join(", ")}.`,
        fixOwner: FixOwner.CLI,
        fix: "Add them under config.locales to manage them here, or leave them to App Store Connect.",
      }),
    );
  }

  return out;
}
