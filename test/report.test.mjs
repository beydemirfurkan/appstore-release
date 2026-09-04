import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReport } from "../src/report/report.mjs";
import { getAppSnapshot } from "../src/report/snapshot.mjs";
import { createContext } from "../src/core/context.mjs";
import { runOperation } from "../src/index.mjs";
import { Severity } from "../src/core/findings.mjs";
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
        attributes: { locale: "en-US", description: "d", keywords: "k", supportUrl: "https://e.com" },
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
  assert.deepEqual(ids(report), ["privacy.declaration.ui-only"]);
  assert.equal(report.verdict, "needs-human");
  assert.equal(report.summary.uiOnly, 1);
  // The distinction the whole exit-code table rests on.
  assert.equal(report.findings[0].uiOnly, true);
  assert.equal(report.nextActions[0].kind, "human");
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

test("a first subscription is flagged as UI-only, a broken one as fixable", () => {
  const config = { locale: "en-US", subscription: { productId: "com.example.pro" } };

  const ready = buildReport({
    snapshot: healthySnapshot({ subscriptions: [{ id: "s", productId: "com.example.pro", state: "READY_TO_SUBMIT" }] }),
    config,
  });
  const uiOnly = ready.findings.find((f) => f.id === "subscription.first.ui-only");
  assert.ok(uiOnly);
  assert.equal(uiOnly.uiOnly, true);
  assert.equal(ready.verdict, "needs-human");

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
