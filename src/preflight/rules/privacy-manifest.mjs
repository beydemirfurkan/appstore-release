// Required-reason APIs: "Starting May 1, 2024, apps that don't describe their use
// of required reason API in their privacy manifest file aren't accepted by App
// Store Connect." And Apple's list of commonly used SDKs must ship their own.

import { LISTED_SDK_PACKAGES, LISTED_SDK_PREFIXES, REQUIRED_REASON_CODES } from "../data.mjs";
import { appFinding, Severity } from "./util.mjs";

/** @param {import("../project.mjs").Project} project */
export function privacyManifest(project) {
  const out = [];
  const hasFile = project.privacyManifests.some((m) => m.source.endsWith(".xcprivacy"));
  const hasConfig = project.privacyManifests.some((m) => m.source.startsWith("app.json"));

  if (!hasFile && !hasConfig && (project.expo || project.native)) {
    // Managed Expo generates PrivacyInfo.xcprivacy at prebuild, and React Native
    // merges every pod's manifest into it; a missing file in the tree is normal.
    const bare = project.native || project.aggregationDisabled;
    out.push(
      appFinding({
        id: "app.privacy-manifest.missing",
        severity: bare ? Severity.WARNING : Severity.INFO,
        title: bare
          ? "No PrivacyInfo.xcprivacy in the iOS project"
          : "No privacy manifest in the config — prebuild will generate one",
        detail: bare
          ? "App Store Connect refuses builds that use required-reason APIs (UserDefaults, file timestamps, boot time, disk space) without declaring why."
          : "Expo and React Native generate PrivacyInfo.xcprivacy and merge every dependency's entries. Declare your own app's reasons in ios.privacyManifests if your code calls these APIs directly.",
        fix: bare
          ? "Add PrivacyInfo.xcprivacy to the app target with NSPrivacyAccessedAPITypes for the APIs your code uses."
          : "Nothing, unless your own code uses a required-reason API: then add expo.ios.privacyManifests.",
      }),
    );
  }
  if (project.aggregationDisabled) {
    out.push(
      appFinding({
        id: "app.privacy-manifest.aggregation-off",
        severity: Severity.WARNING,
        title: "Privacy manifest aggregation is turned off",
        detail:
          "ios/Podfile.properties.json sets apple.privacyManifestAggregationEnabled to 'false', so dependencies' required reasons are not merged into the app's manifest.",
        fix: "Remove that property, or declare every dependency's reasons yourself.",
      }),
    );
  }

  for (const manifest of project.privacyManifests) {
    for (const { type, reasons } of manifest.types) {
      const valid = /** @type {Record<string,string[]>} */ (REQUIRED_REASON_CODES)[type];
      if (!valid) {
        out.push(
          appFinding({
            id: `app.privacy-manifest.unknown-category.${type || "empty"}`,
            severity: Severity.BLOCKER,
            title: `Unknown required-reason category ${type || "(empty)"}`,
            detail: `In ${manifest.source}. Valid categories: ${Object.keys(REQUIRED_REASON_CODES).join(", ")}.`,
            fix: "Use one of Apple's category names exactly.",
          }),
        );
        continue;
      }
      const bad = reasons.filter((r) => !valid.includes(r));
      if (bad.length || !reasons.length) {
        out.push(
          appFinding({
            id: `app.privacy-manifest.invalid-reason.${type}`,
            severity: Severity.BLOCKER,
            title: bad.length ? `Invalid reason ${bad.join(", ")} for ${type}` : `No reason given for ${type}`,
            detail: `In ${manifest.source}. Valid reasons for this category: ${valid.join(", ")}.`,
            fix: "Pick the reason codes that match what your code does with the API.",
          }),
        );
      }
    }
  }

  const listed = [...project.deps].flatMap((d) => {
    if (LISTED_SDK_PACKAGES[d]) return [`${d} (${LISTED_SDK_PACKAGES[d]})`];
    const prefix = Object.keys(LISTED_SDK_PREFIXES).find((p) => d.startsWith(p));
    return prefix ? [`${d} (${/** @type {Record<string,string>} */ (LISTED_SDK_PREFIXES)[prefix]})`] : [];
  });
  if (listed.length) {
    out.push(
      appFinding({
        id: "app.privacy-manifest.sdk",
        severity: Severity.INFO,
        title: `${listed.length} dependenc${listed.length === 1 ? "y brings an SDK" : "ies bring SDKs"} from Apple's privacy-manifest list`,
        detail: `${listed.join("; ")}. These SDKs must ship their own privacy manifest and signature; current versions do.`,
        fix: "Keep them on recent versions; App Store Connect names any that are missing a manifest at upload.",
      }),
    );
  }
  return out;
}
