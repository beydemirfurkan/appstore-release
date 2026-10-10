// Offline preflight: read the app itself — its config, Info.plist, privacy
// manifests and source — and say what App Review is likely to reject before
// anything is uploaded. No credentials, no network.
//
// Severity policy: a BLOCKER only where the answer is certain from what is on
// disk; anything inferred from a dependency or a text search is a WARNING, and
// can be waived with a reason in `preflight.ignore`.

import { loadProject } from "./project.mjs";
import { appFinding, hasAny, Severity } from "./rules/util.mjs";
import { IAP_PACKAGES } from "./data.mjs";
import { permissions } from "./rules/permissions.mjs";
import { privacyManifest } from "./rules/privacy-manifest.mjs";
import { accounts, hasAccounts } from "./rules/accounts.mjs";
import { commerce } from "./rules/commerce.mjs";
import { platform } from "./rules/platform.mjs";
import { purchaseConfigs, subscriptionConfigs } from "../core/products.mjs";

/** In the order they are reported. */
export const RULES = [permissions, privacyManifest, accounts, commerce, platform];

/**
 * @typedef {Object} PreflightResult
 * @property {string} projectDir
 * @property {boolean} found
 * @property {"expo"|"expo-prebuilt"|"native"|null} kind
 * @property {import("../core/findings.mjs").Finding[]} findings
 * @property {string[]} notes          what could not be read, said plainly
 * @property {string[]} manualChecks   what a static pass cannot prove; test it on a device
 */

/**
 * @param {{ projectDir: string, config?: any, expoConfig?: any }} input
 * @returns {PreflightResult}
 */
export function runPreflight({ projectDir, config = null, expoConfig }) {
  const project = loadProject(projectDir, { expoConfig });
  if (!project.found) {
    return {
      projectDir,
      found: false,
      kind: null,
      findings: [
        appFinding({
          id: "app.project.not-found",
          severity: Severity.INFO,
          title: "No app project next to the config",
          detail: `Nothing in ${projectDir} looks like an Expo or Xcode project, so the app itself was not checked.`,
          fix: "Run preflight with --project-dir pointing at the app.",
        }),
      ],
      notes: [],
      manualChecks: [],
    };
  }

  const sellsProducts = subscriptionConfigs(config).length + purchaseConfigs(config).length > 0;
  const raw = [
    ...(project.dynamicConfig
      ? [
          appFinding({
            id: "app.expo-config.dynamic",
            severity: Severity.INFO,
            title: "app.config.js was not evaluated",
            detail:
              "A dynamic Expo config is code; it is only run when asked. Permissions and plugins set there were not seen.",
            fix: "Run preflight with --expo-config to evaluate it (runs `npx expo config`).",
          }),
        ]
      : []),
    ...permissions(project),
    ...privacyManifest(project),
    ...accounts(project),
    ...commerce(project, { sellsProducts }),
    ...platform(project),
  ];

  const { findings, unmatched } = applyIgnores(raw, config?.preflight?.ignore ?? []);
  const notes = [...project.notes, ...unmatched.map((id) => `preflight.ignore lists ${id}, which matched nothing`)];

  return {
    projectDir,
    found: true,
    kind: project.native ? (project.expo ? "expo-prebuilt" : "native") : "expo",
    findings,
    notes,
    manualChecks: manualChecks(project, sellsProducts),
  };
}

/**
 * A waived finding stays visible as INFO with its reason, so the decision is on
 * record rather than silently gone. An id waives itself and everything under it
 * ("app.permission.default-text" covers every key).
 *
 * @param {import("../core/findings.mjs").Finding[]} findings
 * @param {Array<{ id: string, reason: string }>} ignores
 */
export function applyIgnores(findings, ignores) {
  const used = new Set();
  const out = findings.map((f) => {
    const rule = ignores.find((i) => f.id === i.id || f.id.startsWith(`${i.id}.`));
    if (!rule) return f;
    used.add(rule.id);
    return {
      ...f,
      severity: Severity.INFO,
      blocksSubmission: false,
      title: `Ignored: ${f.title}`,
      detail: `${f.detail} Ignored in the config: ${rule.reason}`,
      ignored: { reason: rule.reason },
    };
  });
  return { findings: out, unmatched: ignores.map((i) => i.id).filter((id) => !used.has(id)) };
}

/**
 * What only running the app proves. Listed whenever the thing exists, whether or
 * not a rule fired: passing a text search is not the same as working.
 *
 * @param {import("./project.mjs").Project} project
 * @param {boolean} sellsProducts
 */
function manualChecks(project, sellsProducts) {
  const out = [];
  const usage = [...project.infoPlist.keys()].filter((k) => k.endsWith("UsageDescription"));
  if (usage.length) out.push(`Trigger each permission prompt and read its text: ${usage.join(", ")}`);
  if (hasAccounts(project)) {
    out.push("Create an account, delete it from inside the app, and confirm you cannot sign back in with it");
    out.push("Sign in with the demo account you give App Review, on a fresh install");
  }
  if (sellsProducts || hasAny(project, IAP_PACKAGES)) {
    out.push("Buy in the sandbox, reinstall, and use Restore Purchases");
    out.push("On the paywall: price, period, trial and what follows it, and links to Terms of Use and Privacy Policy");
  }
  return out;
}
