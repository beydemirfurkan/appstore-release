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

  const locale = snapshot.locale;
  const loc = snapshot.localizations.find((l) => l.detailed) ?? null;

  if (!loc) {
    out.push(
      finding({
        id: "metadata.locale.missing",
        category: Category.ASC_STATE,
        title: locale ? `No localization for ${locale}` : "No localization",
        detail: "The version has no localization for the configured locale.",
        fix: "Run the metadata operation; it creates the localization if it is absent.",
        fixCommand: "appstore-release metadata",
      }),
    );
    return out;
  }

  for (const [field, label] of REQUIRED) {
    if (!loc.attributes?.[field]) {
      out.push(
        finding({
          id: `metadata.${field}.missing`,
          category: Category.ASC_STATE,
          title: `${label} is empty`,
          detail: `appStoreVersionLocalizations.${field} is not set for ${loc.attributes.locale}.`,
          fix: `Set metadata.${field === "description" ? "description" : field} in your config and run metadata.`,
          fixCommand: "appstore-release metadata",
          evidence: { resource: "appStoreVersionLocalizations", id: loc.id },
        }),
      );
    }
  }

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

  const undone = snapshot.localizations.filter((l) => !l.detailed);
  if (undone.length) {
    out.push(
      finding({
        id: "metadata.locale.unlocalized",
        severity: Severity.INFO,
        category: Category.ASC_STATE,
        title: `${undone.length} other locale(s) exist on this version`,
        detail: `Only ${loc.attributes.locale} was checked: ${undone.map((l) => l.attributes.locale).join(", ")}.`,
        fixOwner: FixOwner.UI,
        fix: "Multi-locale support is not automated yet; review the other locales in App Store Connect.",
      }),
    );
  }

  return out;
}
