import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReport } from "../src/report/report.mjs";
import { getAppSnapshot } from "../src/report/snapshot.mjs";
import { createContext } from "../src/core/context.mjs";
import { runOperation } from "../src/index.mjs";
import { Severity } from "../src/core/findings.mjs";
import { isFirstVersion } from "../src/core/status.mjs";
import { renderReportMarkdown } from "../src/report/render.mjs";
import { createMockAsc, readyToPrepareRoutes, testCredentials } from "./helpers/mock-asc.mjs";

/** A snapshot with everything in order; each test spoils one thing. */
function healthySnapshot(overrides = {}) {
  return {
    generatedAt: "2026-09-05T00:00:00.000Z",
    app: {
      id: "1",
      attributes: {
        name: "Test App",
        bundleId: "com.example.test",
        contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT",
      },
    },
    version: {
      id: "v1",
      attributes: { versionString: "1.1", appStoreState: "PREPARE_FOR_SUBMISSION", copyright: "2026" },
    },
    versions: [
      { id: "v1", attributes: { versionString: "1.1", appStoreState: "PREPARE_FOR_SUBMISSION" } },
      { id: "v0", attributes: { versionString: "1.0" } },
    ],
    build: { id: "b1", attributes: { version: "7", processingState: "VALID", expired: false } },
    latestBuilds: [{ id: "b1", attributes: { version: "7", processingState: "VALID", expired: false } }],
    appInfo: {
      id: "i1",
      relationships: {
        primaryCategory: { data: { id: "PRODUCTIVITY" } },
        ageRatingDeclaration: { data: { id: "a1" } },
      },
    },
    appInfoIncluded: [],
    localizations: [
      {
        id: "l1",
        detailed: true,
        attributes: {
          locale: "en-US",
          description: "d",
          keywords: "k",
          supportUrl: "https://e.com",
          whatsNew: "Fixes",
        },
      },
    ],
    screenshotSets: [
      {
        id: "s1",
        locale: "en-US",
        displayType: "APP_IPHONE_67",
        screenshots: [{ id: "sc1", fileName: "01.png", state: "COMPLETE" }],
      },
    ],
    pricing: { hasSchedule: true },
    subscriptions: [],
    reviewDetail: {
      attributes: { contactFirstName: "Ada", contactLastName: "L", contactPhone: "1", contactEmail: "a@e.com" },
    },
    submission: null,
    locale: "en-US",
    errors: [],
    ...overrides,
  };
}

const ids = (report) => report.findings.map((f) => f.id).sort();

test("a healthy app still needs a human: App Privacy has no API", () => {
  const report = buildReport({ snapshot: healthySnapshot(), config: { locale: "en-US" } });
  const blocking = report.findings.filter((f) => f.severity === "blocker");
  assert.deepEqual(
    blocking.map((f) => f.id),
    ["privacy.declaration.ui-only"],
  );
  assert.equal(report.verdict, "needs-human");
  assert.equal(report.summary.uiOnly, 1);
  // The distinction the whole exit-code table rests on.
  assert.equal(blocking[0].uiOnly, true);
  assert.equal(report.nextActions[0].kind, "human");
  // iPhone Duo is advice until Apple's date, never a blocker: we cannot read the SDK.
  assert.notEqual(report.findings.find((f) => f.id === "screenshots.duo.missing")?.severity, "blocker");
});

test("review.privacyPublished lets a healthy app reach ready, without pretending to verify it", () => {
  const report = buildReport({
    snapshot: healthySnapshot(),
    config: { locale: "en-US", review: { privacyPublished: true } },
  });
  assert.equal(report.verdict, "ready");
  const privacy = report.findings.find((f) => f.id === "privacy.declaration.ui-only");
  assert.ok(privacy, "the reminder stays in the report");
  assert.equal(privacy.severity, "info");
  assert.equal(privacy.uiOnly, true, "who can fix it did not change");
  assert.deepEqual(report.nextActions, []);
});

test("no editable version stops everything and says why", () => {
  const report = buildReport({
    snapshot: healthySnapshot({
      version: null,
      versions: [{ id: "v1", attributes: { versionString: "1.0", appStoreState: "READY_FOR_DISTRIBUTION" } }],
    }),
    config: { locale: "en-US" },
  });
  assert.ok(ids(report).includes("version.none"));
  // Guards the old behaviour, where a missing editable version silently fell
  // back to whatever ASC returned first — possibly the live one.
  assert.equal(report.verdict, "live");
});

test("a missing build names the build that is ready to attach", () => {
  const report = buildReport({ snapshot: healthySnapshot({ build: null }), config: { locale: "en-US" } });
  const f = report.findings.find((x) => x.id === "version.build.missing");
  assert.ok(f);
  assert.equal(f.fixCommand, "appstore-release attach-build");
  assert.equal(report.verdict, "blocked");
  assert.equal(report.nextActions[0].command, "appstore-release attach-build");
});

test("screenshots placed through the App Asset Library count, matched by pixel size", () => {
  const report = buildReport({
    snapshot: healthySnapshot({
      screenshotSets: [],
      placements: [
        {
          id: "p1",
          locale: "en-US",
          placementGroup: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE",
          width: 1320,
          height: 2868,
          assetState: "PREPARE_FOR_SUBMISSION",
        },
        {
          id: "p2",
          locale: "en-US",
          placementGroup: "IPHONE_DUO_OUTER_PROFILE",
          width: 1398,
          height: 2034,
          assetState: "PREPARE_FOR_SUBMISSION",
        },
      ],
    }),
    config: { locale: "en-US", review: { privacyPublished: true } },
  });
  assert.ok(
    !ids(report).some((id) => id.startsWith("screenshots.count.zero")),
    "6.9-inch placements satisfy APP_IPHONE_67",
  );
  assert.ok(!ids(report).includes("screenshots.duo.missing"), "a Duo placement is recognised");
  assert.equal(report.verdict, "ready");
});

test("iPhone Duo turns from advice into a warning on Apple's date", () => {
  const at = (date) =>
    buildReport({ snapshot: healthySnapshot(), config: { locale: "en-US" }, now: Date.parse(date) }).findings.find(
      (f) => f.id === "screenshots.duo.missing",
    )?.severity;
  assert.equal(at("2026-10-10"), "info");
  assert.equal(at("2027-04-02"), "warning");
});

test("reserved-but-uncommitted screenshots are reported, not counted as present", () => {
  const report = buildReport({
    snapshot: healthySnapshot({
      screenshotSets: [
        {
          id: "s1",
          locale: "en-US",
          displayType: "APP_IPHONE_67",
          screenshots: [{ id: "sc1", fileName: "01.png", state: "UPLOAD_COMPLETE" }],
        },
      ],
    }),
    config: { locale: "en-US" },
  });
  assert.ok(ids(report).includes("screenshots.upload.incomplete"));
});

test("a first subscription travels with the version too, and says what happens if Apple refuses", () => {
  const config = {
    locale: "en-US",
    subscription: { productId: "com.example.pro" },
    review: { privacyPublished: true },
  };

  // The app's FIRST subscription goes in the same submission; the clicks are the fallback.
  const first = buildReport({
    snapshot: healthySnapshot({ subscriptions: [{ id: "s", productId: "com.example.pro", state: "READY_TO_SUBMIT" }] }),
    config,
  });
  const withVersion = first.findings.find((f) => f.id === "subscription.first.with-version");
  assert.equal(withVersion?.severity, "info");
  assert.equal(withVersion?.uiOnly, false);
  assert.ok(withVersion?.fixClicks?.includes("Add for Review"));
  assert.match(withVersion?.fix ?? "", /--skip-products/);
  assert.equal(first.verdict, "ready");

  // With an approved plan already on sale, a new one is submitted by API.
  const later = buildReport({
    snapshot: healthySnapshot({
      subscriptions: [
        { id: "y", productId: "com.example.yearly", state: "APPROVED" },
        { id: "s", productId: "com.example.pro", state: "READY_TO_SUBMIT" },
      ],
    }),
    config,
  });
  assert.equal(
    later.findings.find((f) => f.id === "subscription.first.with-version"),
    undefined,
  );
  assert.equal(later.findings.find((f) => f.id === "subscription.ready-to-submit")?.severity, "info");
  assert.equal(later.verdict, "ready");

  const missing = buildReport({
    snapshot: healthySnapshot({
      subscriptions: [{ id: "s", productId: "com.example.pro", state: "MISSING_METADATA" }],
    }),
    config,
  });
  const fixable = missing.findings.find((f) => f.id === "subscription.missing-metadata");
  assert.ok(fixable);
  assert.equal(fixable.uiOnly, false);
  assert.equal(missing.verdict, "blocked");
});

test("a rejected version is its own verdict, and the message is honestly UI-only", () => {
  const report = buildReport({
    snapshot: healthySnapshot({
      version: { id: "v1", attributes: { versionString: "1.1", appStoreState: "REJECTED", copyright: "2026" } },
    }),
    config: { locale: "en-US" },
  });
  assert.equal(report.verdict, "rejected");
  const f = report.findings.find((x) => x.id === "submission.rejected");
  assert.ok(f);
  assert.equal(f.uiOnly, true, "Resolution Center text is not in the API");
});

test("whatsNew on a first version is caught before Apple 409s", () => {
  const report = buildReport({
    snapshot: healthySnapshot({
      version: {
        id: "v1",
        attributes: { versionString: "1.0", appStoreState: "PREPARE_FOR_SUBMISSION", copyright: "2026" },
      },
      versions: [{ id: "v1", attributes: { versionString: "1.0" } }],
    }),
    config: { locale: "en-US", metadata: { whatsNew: "Bug fixes" } },
  });
  const f = report.findings.find((x) => x.id === "metadata.whatsNew.first-version");
  assert.ok(f);
  assert.equal(f.severity, Severity.WARNING);
});

test("next actions collapse per command and put human work last", () => {
  const report = buildReport({
    snapshot: healthySnapshot({
      build: null,
      pricing: { hasSchedule: false },
      appInfo: { id: "i", relationships: {} },
    }),
    config: { locale: "en-US" },
  });
  const kinds = report.nextActions.map((a) => a.kind);
  assert.deepEqual([...new Set(kinds)], ["run", "human"], "runnable work must come before manual work");
  assert.equal(
    new Set(report.nextActions.filter((a) => a.command).map((a) => a.command)).size,
    report.nextActions.filter((a) => a.command).length,
    "one action per command",
  );
});

test("an unreadable section degrades the report instead of killing it", () => {
  const report = buildReport({
    snapshot: healthySnapshot({ errors: ["pricing: HTTP 403"] }),
    config: { locale: "en-US" },
  });
  assert.deepEqual(report.errors, ["pricing: HTTP 403"]);
  assert.ok(report.verdict);
});

test("check returns the report as data and never reports its own failure", async () => {
  const mock = createMockAsc({ routes: readyToPrepareRoutes(), strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config: { locale: "en-US" },
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: process.cwd() },
  });
  const res = await runOperation("check", ctx);
  assert.notEqual(res.status, "error", "reading the state succeeded even if the state is bad");
  assert.equal(res.details.schemaVersion, "1");
  assert.ok(res.details.verdict);
  assert.ok(Array.isArray(res.details.nextActions));
  assert.equal(mock.mutations().length, 0, "check must not write");
});

test("status returns the snapshot as data, not just printed text", async () => {
  const mock = createMockAsc({ routes: readyToPrepareRoutes(), strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config: { locale: "en-US" },
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: process.cwd() },
  });
  const res = await runOperation("status", ctx);
  assert.equal(res.details.app.attributes.name, "Test App");
  assert.equal(mock.mutations().length, 0);
});

test("the terminal plan collapses to one `release` when the pipeline fixes everything", async () => {
  const { renderReportText } = await import("../src/report/render.mjs");
  const report = buildReport({
    snapshot: healthySnapshot({ build: null, reviewDetail: null }),
    config: { locale: "en-US" },
  });
  const text = renderReportText(report);
  assert.match(text, /\$ appstore-release release\s+fixes all \d+/);
  assert.doesNotMatch(text, /\$ appstore-release attach-build/, "not one command per finding");
  assert.match(text, /you: /, "the App Privacy step is still listed for a person");
});

test("colour is on for a terminal, off for pipes, and NO_COLOR / FORCE_COLOR win", async () => {
  const { createStyle } = await import("../src/cli/style.mjs");
  assert.equal(createStyle({ isTTY: true }, {}).enabled, true);
  assert.equal(createStyle({ isTTY: false }, {}).enabled, false);
  assert.equal(createStyle({ isTTY: true }, { NO_COLOR: "" }).enabled, false);
  assert.equal(createStyle({ isTTY: false }, { FORCE_COLOR: "1" }).enabled, true);
  assert.equal(createStyle({ isTTY: true }, { FORCE_COLOR: "0" }).enabled, true);
});

test("an update must say what changed in every locale; a first version must not", () => {
  const noWhatsNew = [
    {
      id: "l1",
      detailed: true,
      attributes: { locale: "en-US", description: "d", keywords: "k", supportUrl: "https://e.com" },
    },
  ];
  const update = buildReport({ snapshot: healthySnapshot({ localizations: noWhatsNew }), config: { locale: "en-US" } });
  const f = update.findings.find((x) => x.id === "metadata.whatsNew.missing");
  assert.equal(f?.severity, Severity.BLOCKER);
  assert.equal(f?.fixCommand, "appstore-release metadata");

  const first = buildReport({
    snapshot: healthySnapshot({
      localizations: noWhatsNew,
      versions: [{ id: "v1", attributes: { versionString: "1.1", appStoreState: "PREPARE_FOR_SUBMISSION" } }],
    }),
    config: { locale: "en-US" },
  });
  assert.equal(
    first.findings.some((x) => x.id === "metadata.whatsNew.missing"),
    false,
  );
});

test("isFirstVersion: no other version on the same platform, whatever the number says", () => {
  const v = (id, platform) => ({ id, attributes: { versionString: "1.0", platform } });
  assert.equal(isFirstVersion([v("a", "IOS")], v("a", "IOS")), true);
  assert.equal(isFirstVersion([v("a", "IOS"), v("b", "IOS")], v("a", "IOS")), false);
  // A Mac version of the same app does not make the iOS one an update.
  assert.equal(isFirstVersion([v("a", "IOS"), v("m", "MAC_OS")], v("a", "IOS")), true);
  assert.equal(isFirstVersion([], null), false);
});

test("a subscription needs a Terms of Use link, unless a custom EULA is set or nothing is known", () => {
  const config = (description) => ({
    locale: "en-US",
    metadata: { description },
    subscription: { productId: "pro", name: "Pro", period: "ONE_MONTH" },
  });
  const terms = (snapshot, cfg) =>
    buildReport({ snapshot: healthySnapshot(snapshot), config: cfg }).findings.find(
      (x) => x.id === "subscription.terms-link.missing",
    );

  const missing = terms({ eula: { custom: false } }, config("Plan your meals."));
  assert.equal(missing?.severity, Severity.WARNING);
  assert.equal(missing?.guideline, "3.1.2");

  const standard = "Terms of Use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
  assert.equal(terms({ eula: { custom: false } }, config(`Plan your meals.\n${standard}`)), undefined);
  assert.equal(terms({ eula: { custom: false } }, config("Terms of Use: https://example.com/terms")), undefined);
  assert.equal(terms({ eula: { custom: true } }, config("Plan your meals.")), undefined);
  assert.equal(terms({ eula: null }, config("Plan your meals.")), undefined, "unknown is not missing");
});

test("next actions say which commands write to App Store Connect", () => {
  const report = buildReport({
    snapshot: healthySnapshot({ pricing: { hasSchedule: false } }),
    config: { locale: "en-US" },
  });
  const pricing = report.nextActions.find((a) => a.command === "appstore-release pricing");
  assert.equal(pricing?.mutates, true);
  assert.match(renderReportMarkdown(report), /`appstore-release pricing` \(writes to App Store Connect\)/);
});

test("sign-in without a demo account or a word about it in the notes is a warning", () => {
  const signals = { signIn: true, logins: [], purchases: false, permissions: [] };
  const demo = (/** @type {any} */ config, /** @type {any} */ preflight = { findings: [], signals }) =>
    buildReport({ snapshot: healthySnapshot({ preflight }), config: { locale: "en-US", ...config } }).findings.find(
      (f) => f.id === "review.demo.likely-needed",
    );
  assert.equal(demo({})?.severity, Severity.WARNING);
  assert.equal(demo({})?.guideline, "2.1");
  assert.equal(demo({ review: { demoAccountName: "review@example.com" } }), undefined);
  assert.equal(demo({ review: { notes: "No login is needed: every feature works offline." } }), undefined);
  assert.equal(demo({}, { findings: [], signals: { ...signals, signIn: false } }), undefined);
  assert.equal(demo({}, null), undefined, "no preflight, no guess");
});
