// Tracking, transport security, secrets in source, export compliance.

import { ATT_PACKAGES, TRACKING_PACKAGES } from "../data.mjs";
import { appFinding, hasAny, locate, Severity } from "./util.mjs";

const INSECURE_URL = /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.)[^"'`\s]+/;
const SECRETS = [
  { id: "stripe-live-key", pattern: /sk_live_[0-9A-Za-z]{10,}/, what: "a Stripe live secret key" },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/, what: "an AWS access key id" },
  { id: "private-key", pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, what: "a private key" },
];

/** @param {import("../project.mjs").Project} project */
export function platform(project) {
  const out = [];
  const trackers = TRACKING_PACKAGES.filter((p) => project.deps.has(p));
  if (trackers.length && !project.infoPlist.has("NSUserTrackingUsageDescription") && !hasAny(project, ATT_PACKAGES)) {
    out.push(
      appFinding({
        id: "app.tracking.prompt",
        guideline: "5.1.2(i)",
        severity: Severity.WARNING,
        title: `${trackers.join(", ")} without App Tracking Transparency`,
        detail:
          '"You must receive explicit permission from users via the App Tracking Transparency APIs to track their activity." ' +
          "Advertising and attribution SDKs usually track unless configured not to.",
        fix: "Add expo-tracking-transparency with a specific NSUserTrackingUsageDescription and ask before tracking — or configure the SDK for non-personalised use and declare no tracking in App Privacy.",
      }),
    );
  }

  const ats = project.infoPlist.get("NSAppTransportSecurity")?.value;
  const insecure = locate(project, INSECURE_URL);
  if (ats?.NSAllowsArbitraryLoads === true || insecure) {
    out.push(
      appFinding({
        id: "app.ats.insecure",
        severity: Severity.WARNING,
        title:
          ats?.NSAllowsArbitraryLoads === true
            ? "App Transport Security is turned off"
            : "Plain http:// URL in the code",
        detail:
          ats?.NSAllowsArbitraryLoads === true
            ? "NSAllowsArbitraryLoads is true; App Review asks for a justification."
            : "iOS blocks plain HTTP by default; the request fails at runtime.",
        fix: "Use https://, or scope an exception to the one domain that needs it.",
        ...(insecure ? { location: insecure } : {}),
      }),
    );
  }

  for (const { id, pattern, what } of SECRETS) {
    const where = locate(project, pattern);
    if (!where) continue;
    out.push(
      appFinding({
        id: `app.secrets.${id}`,
        severity: Severity.WARNING,
        title: `What looks like ${what} is in the app's code`,
        detail: "Anything in the bundle can be read by anyone who downloads the app.",
        fix: "Move it to your server and rotate it.",
        location: where,
      }),
    );
  }

  if (!project.infoPlist.has("ITSAppUsesNonExemptEncryption") && (project.expo || project.native)) {
    out.push(
      appFinding({
        id: "app.export-compliance",
        severity: Severity.INFO,
        title: "Export compliance is not declared in the build",
        detail:
          "Without ITSAppUsesNonExemptEncryption, App Store Connect asks the export compliance questions for every upload, and TestFlight waits until they are answered.",
        fix: project.expo
          ? 'Set "ios": { "config": { "usesNonExemptEncryption": false } } in app.json if the app only uses HTTPS and system encryption.'
          : "Add ITSAppUsesNonExemptEncryption (NO if the app only uses exempt encryption such as HTTPS) to Info.plist.",
      }),
    );
  }
  return out;
}
