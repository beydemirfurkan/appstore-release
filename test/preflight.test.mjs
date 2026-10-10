import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePlist } from "../src/preflight/plist.mjs";
import { loadProject } from "../src/preflight/project.mjs";
import { runPreflight, applyIgnores } from "../src/preflight/index.mjs";
import { buildReport } from "../src/report/report.mjs";
import { renderReportMarkdown, renderReportText } from "../src/report/render.mjs";
import { validateConfig } from "../src/core/requirements.mjs";
import { main } from "../src/cli.mjs";
import { Exit } from "../src/core/status.mjs";
import { Severity } from "../src/core/findings.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/preflight");
const fixture = (/** @type {string} */ name) => join(FIXTURES, name);

const byId = (/** @type {any} */ result) => new Map(result.findings.map((/** @type {any} */ f) => [f.id, f]));
const ofSeverity = (/** @type {any} */ result, /** @type {string} */ s) =>
  result.findings.filter((/** @type {any} */ f) => f.severity === s).map((/** @type {any} */ f) => f.id);

/** A throwaway project directory with the given files. @param {Record<string, string>} files */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function capture() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (/** @type {string} */ s) => out.push(s) },
    stderr: { write: (/** @type {string} */ s) => err.push(s) },
    get outText() {
      return out.join("");
    },
    get errText() {
      return err.join("");
    },
  };
}

// --- plist ---------------------------------------------------------------

test("the plist reader handles what Info.plist and xcprivacy files contain", () => {
  const { value } = /** @type {any} */ (
    parsePlist(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<!-- a comment -->
	<key>Name</key>
	<string>Fish &amp; Chips</string>
	<key>Spaces</key>
	<string>  </string>
	<key>On</key>
	<true/>
	<key>Off</key>
	<false/>
	<key>Count</key>
	<integer>42</integer>
	<key>Ratio</key>
	<real>1.5</real>
	<key>Empty</key>
	<dict/>
	<key>List</key>
	<array>
		<string>a</string>
		<dict>
			<key>k</key>
			<string>v</string>
		</dict>
	</array>
</dict>
</plist>`)
  );
  assert.deepEqual(value, {
    Name: "Fish & Chips",
    Spaces: "  ",
    On: true,
    Off: false,
    Count: 42,
    Ratio: 1.5,
    Empty: {},
    List: ["a", { k: "v" }],
  });
});

test("a binary or broken plist is reported, not misread", () => {
  assert.deepEqual(parsePlist("bplist00\u0000\u0001"), { error: "binary plist" });
  assert.deepEqual(parsePlist("<html></html>"), { error: "not a plist" });
  assert.ok("error" in parsePlist("<plist><dict><key>a</key></dict></plist>"));
});

// --- reading a project ---------------------------------------------------

test("Expo plugin options beat ios.infoPlist, which beats the plugin default; false removes the key", () => {
  const dir = project({
    "package.json": JSON.stringify({ dependencies: { expo: "54", "expo-camera": "17", "expo-image-picker": "17" } }),
    "app.json": JSON.stringify({
      expo: {
        plugins: [
          ["expo-camera", { cameraPermission: "From the plugin option", microphonePermission: false }],
          "expo-image-picker",
        ],
        ios: { infoPlist: { NSCameraUsageDescription: "From ios.infoPlist", NSPhotoLibraryUsageDescription: "Mine" } },
      },
    }),
  });
  const p = loadProject(dir);
  assert.equal(p.managed, true);
  assert.equal(p.infoPlist.get("NSCameraUsageDescription")?.value, "From the plugin option");
  // expo-image-picker has no option for photos here, so ios.infoPlist wins over its default …
  assert.equal(p.infoPlist.get("NSPhotoLibraryUsageDescription")?.value, "Mine");
  // … and its microphone default comes back, because the image picker's entry was not disabled.
  assert.equal(p.infoPlist.get("NSMicrophoneUsageDescription")?.source, "plugin expo-image-picker (default text)");
});

test("in a native project, Info.plist and INFOPLIST_KEY_ build settings are what ships", () => {
  const p = loadProject(fixture("native-bad"));
  assert.equal(p.native, true);
  assert.equal(p.expo, false);
  assert.equal(p.infoPlist.get("NSCameraUsageDescription")?.value, "Camera");
  assert.equal(p.infoPlist.get("NSCameraUsageDescription")?.source, "ios/Pantry.xcodeproj/project.pbxproj");
  assert.equal(p.infoPlist.get("ITSAppUsesNonExemptEncryption")?.value, false);
  assert.equal(p.infoPlist.get("NSAppTransportSecurity")?.value.NSAllowsArbitraryLoads, true);
  assert.equal(p.privacyManifests[0].source, "ios/Pantry/PrivacyInfo.xcprivacy");
});

test("a dynamic app.config.js is not executed unless asked, and says so", () => {
  const dir = project({
    "package.json": JSON.stringify({ dependencies: { expo: "54" } }),
    "app.config.js": "throw new Error('must not run')",
  });
  const result = runPreflight({ projectDir: dir });
  assert.equal(byId(result).get("app.expo-config.dynamic")?.severity, Severity.INFO);

  const evaluated = runPreflight({
    projectDir: dir,
    expoConfig: { plugins: ["expo-camera"], ios: { config: { usesNonExemptEncryption: false } } },
  });
  assert.equal(byId(evaluated).has("app.expo-config.dynamic"), false);
  assert.equal(byId(evaluated).has("app.export-compliance"), false);
});

test("no project at all is information, not a failure", () => {
  const result = runPreflight({ projectDir: project({ "README.md": "hi" }) });
  assert.equal(result.found, false);
  assert.deepEqual(
    result.findings.map((f) => [f.id, f.severity]),
    [["app.project.not-found", Severity.INFO]],
  );
});

// --- rules ---------------------------------------------------------------

test("expo-bad: the certain problem blocks, the inferred ones warn", () => {
  const result = runPreflight({ projectDir: fixture("expo-bad") });
  assert.equal(result.kind, "expo");
  assert.deepEqual(ofSeverity(result, Severity.BLOCKER), [
    "app.privacy-manifest.invalid-reason.NSPrivacyAccessedAPICategoryUserDefaults",
  ]);
  assert.deepEqual(ofSeverity(result, Severity.WARNING).sort(), [
    "app.account-deletion",
    "app.ats.insecure",
    "app.login.equivalent-option",
    "app.payments.external",
    "app.permission.default-text.NSCameraUsageDescription",
    "app.permission.default-text.NSMicrophoneUsageDescription",
    // Managed Expo: a plugin might add it at prebuild, so this is not certain.
    "app.permission.missing.NSLocationWhenInUseUsageDescription",
    "app.tracking.prompt",
  ]);

  const f = byId(result);
  assert.equal(f.get("app.account-deletion").guideline, "5.1.1(v)");
  assert.deepEqual(f.get("app.account-deletion").location, { file: "src/auth.ts", line: 5 });
  assert.equal(f.get("app.login.equivalent-option").guideline, "4.8");
  assert.match(f.get("app.permission.missing.NSLocationWhenInUseUsageDescription").fix, /expo-location/);
  assert.match(f.get("app.privacy-manifest.sdk").detail, /GoogleSignIn/);
  for (const finding of result.findings) {
    assert.equal(finding.category, "app");
    assert.equal(finding.fixOwner, "external");
    assert.equal(finding.uiOnly, false);
  }
});

test("expo-good: nothing to block or warn about", () => {
  const result = runPreflight({ projectDir: fixture("expo-good"), config: { subscription: { productId: "pro" } } });
  assert.deepEqual(ofSeverity(result, Severity.BLOCKER), []);
  assert.deepEqual(ofSeverity(result, Severity.WARNING), []);
  // What a static pass cannot prove is still listed.
  assert.ok(result.manualChecks.some((m) => /Restore Purchases/.test(m)));
  assert.ok(result.manualChecks.some((m) => /delete it from inside the app/.test(m)));
  assert.ok(result.manualChecks.some((m) => /NSCameraUsageDescription/.test(m)));
});

test("native-bad: a native API without its usage description blocks, pointing at the code", () => {
  const result = runPreflight({ projectDir: fixture("native-bad") });
  assert.equal(result.kind, "native");
  assert.deepEqual(ofSeverity(result, Severity.BLOCKER).sort(), [
    "app.permission.missing.NSLocationWhenInUseUsageDescription",
    "app.privacy-manifest.invalid-reason.NSPrivacyAccessedAPICategoryFileTimestamp",
    "app.privacy-manifest.unknown-category.NSPrivacyAccessedAPICategoryClipboard",
  ]);
  const f = byId(result);
  assert.deepEqual(f.get("app.permission.missing.NSLocationWhenInUseUsageDescription").location, {
    file: "ios/Pantry/StoreLocator.swift",
    line: 4,
  });
  assert.match(f.get("app.permission.default-text.NSCameraUsageDescription").title, /too short/);
  assert.match(f.get("app.ats.insecure").title, /App Transport Security is turned off/);
  // INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO answers export compliance.
  assert.equal(f.has("app.export-compliance"), false);
});

test("purchases without a restore path warn; the restore call silences it", () => {
  const files = {
    "package.json": JSON.stringify({ dependencies: { expo: "54", "react-native-purchases": "9" } }),
    "src/paywall.ts": "export const buy = (p) => Purchases.purchasePackage(p);",
  };
  assert.ok(byId(runPreflight({ projectDir: project(files) })).has("app.subscription.restore"));
  const fixed = project({ ...files, "src/settings.ts": "export const r = () => Purchases.restorePurchases();" });
  assert.equal(byId(runPreflight({ projectDir: fixed })).has("app.subscription.restore"), false);
});

test("secrets in the source are flagged where they are", () => {
  // Assembled at runtime so no secret-shaped string is ever committed.
  const stripe = ["sk", "live", "0123456789abcdefABCDEF"].join("_");
  const aws = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
  const dir = project({
    "package.json": JSON.stringify({ dependencies: { expo: "54" } }),
    "src/config.ts": `export const a = 1;\nexport const STRIPE = "${stripe}";\nexport const AWS = "${aws}";\n`,
  });
  const f = byId(runPreflight({ projectDir: dir }));
  assert.deepEqual(f.get("app.secrets.stripe-live-key")?.location, { file: "src/config.ts", line: 2 });
  assert.deepEqual(f.get("app.secrets.aws-access-key")?.location, { file: "src/config.ts", line: 3 });
});

test("node_modules, Pods and tests are not scanned", () => {
  const dir = project({
    "package.json": JSON.stringify({ dependencies: { expo: "54" } }),
    "node_modules/x/index.js": 'fetch("http://insecure.example")',
    "ios/Pods/X/X.swift": "let m = CLLocationManager()",
    "__tests__/a.test.ts": 'fetch("http://insecure.example")',
    "src/ok.ts": 'fetch("http://localhost:8081")',
  });
  const f = byId(runPreflight({ projectDir: dir }));
  assert.equal(f.has("app.ats.insecure"), false);
  assert.equal(
    [...f.keys()].some((id) => id.startsWith("app.permission.missing")),
    false,
  );
});

// --- waivers -------------------------------------------------------------

test("preflight.ignore turns a finding into information with its reason, by id or by prefix", () => {
  const result = runPreflight({
    projectDir: fixture("expo-bad"),
    config: {
      preflight: {
        ignore: [
          { id: "app.account-deletion", reason: "Accounts are created and deleted on our website only" },
          { id: "app.permission.default-text", reason: "Copy lands in the next build" },
          { id: "app.does-not-exist", reason: "stale" },
        ],
      },
    },
  });
  const f = byId(result);
  const waived = f.get("app.account-deletion");
  assert.equal(waived.severity, Severity.INFO);
  assert.equal(waived.blocksSubmission, false);
  assert.deepEqual(waived.ignored, { reason: "Accounts are created and deleted on our website only" });
  assert.match(waived.detail, /website only/);
  assert.equal(f.get("app.permission.default-text.NSCameraUsageDescription").severity, Severity.INFO);
  assert.equal(f.get("app.permission.default-text.NSMicrophoneUsageDescription").severity, Severity.INFO);
  assert.ok(result.notes.includes("preflight.ignore lists app.does-not-exist, which matched nothing"));
});

test("a waiver must give a reason and name an app finding", () => {
  const base = { bundleId: "com.example.a", locale: "en-US" };
  assert.equal(
    validateConfig({ ...base, preflight: { ignore: [{ id: "app.secrets", reason: "a test key" }] } }).valid,
    true,
  );
  assert.equal(validateConfig({ ...base, preflight: { ignore: [{ id: "app.secrets" }] } }).valid, false);
  assert.equal(validateConfig({ ...base, preflight: { ignore: [{ id: "metadata.x", reason: "why" }] } }).valid, false);
  // Prefix matching never crosses a dot boundary it was not given.
  const { findings } = applyIgnores(
    [/** @type {any} */ ({ id: "app.secretsauce", severity: Severity.WARNING, title: "t", detail: "d" })],
    [{ id: "app.secrets", reason: "x" }],
  );
  assert.equal(findings[0].severity, Severity.WARNING);
});

// --- surfaces ------------------------------------------------------------

test("CLI: preflight needs no credentials, exits 4 on a certain rejection and 0 otherwise", async () => {
  const env = {};
  const cwd = "/nonexistent-so-no-config-is-found";
  const bad = capture();
  assert.equal(await main(["preflight", "--project-root", fixture("expo-bad")], { ...bad, env, cwd }), Exit.BLOCKED);
  assert.match(bad.outText, /Will be rejected \(1\)/);
  assert.match(bad.outText, /app\.account-deletion · Guideline 5\.1\.1\(v\) · src\/auth\.ts:5/);
  assert.match(bad.outText, /Test on a device/);

  const good = capture();
  assert.equal(await main(["preflight", "--project-root", fixture("expo-good")], { ...good, env, cwd }), Exit.OK);
  assert.match(good.outText, /✓ nothing certain to be rejected/);

  const json = capture();
  assert.equal(
    await main(["preflight", "--project-root", fixture("native-bad"), "--json"], { ...json, env, cwd }),
    Exit.BLOCKED,
  );
  const parsed = JSON.parse(json.outText);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.kind, "native");

  const zero = capture();
  assert.equal(
    await main(["preflight", "--project-root", fixture("native-bad"), "--exit-zero"], { ...zero, env, cwd }),
    Exit.OK,
  );

  const missing = capture();
  assert.equal(await main(["preflight", "--project-root", "/nonexistent-dir"], { ...missing, env, cwd }), Exit.USAGE);
  assert.match(missing.errText, /not a directory/);
});

test("the readiness report puts the App section first and asks the person to fix it", () => {
  const preflight = runPreflight({ projectDir: fixture("native-bad") });
  const report = buildReport({
    snapshot: {
      generatedAt: "2026-10-10T00:00:00.000Z",
      app: { id: "1", attributes: { name: "Pantry" } },
      version: null,
      versions: [],
      screenshotSets: [],
      subscriptions: [],
      pricing: { hasSchedule: true },
      errors: [],
      preflight,
    },
  });
  assert.equal(report.sections[0].id, "app");
  assert.equal(report.sections[0].state, "blocked");
  assert.equal(report.verdict, "blocked");
  assert.deepEqual(report.preflight?.manualChecks, preflight.manualChecks);

  const text = renderReportText(report);
  assert.match(text, /✗ App\b/);
  assert.match(text, /you: No NSLocationWhenInUseUsageDescription.*ios\/Pantry\/StoreLocator\.swift:4/);
  // The app's own blockers are the person's, beside what this tool can still do.
  assert.match(text, /5 things in the way · 2 fixable here, 3 need you/);

  const md = renderReportMarkdown(report);
  assert.match(
    md,
    /\| No NSLocationWhenInUseUsageDescription, but the app uses location.* \(Guideline 5\.1\.1\(ii\), `ios\/Pantry\/StoreLocator\.swift:4`\) \| you, outside App Store Connect \|/,
  );
});

test("a snapshot without a preflight reads as an App section with nothing in it", () => {
  const report = buildReport({
    snapshot: {
      generatedAt: "",
      app: null,
      version: null,
      versions: [],
      screenshotSets: [],
      subscriptions: [],
      pricing: {},
      errors: [],
    },
  });
  assert.equal(report.sections[0].id, "app");
  assert.equal(report.sections[0].state, "ok");
  assert.equal(report.preflight, null);
});
