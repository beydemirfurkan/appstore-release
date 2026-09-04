import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveLocales, localeCodes, primaryLocale } from "../src/core/locales.mjs";
import { validateConfig } from "../src/core/requirements.mjs";
import { buildReport } from "../src/report/report.mjs";
import { createContext } from "../src/core/context.mjs";
import { runOperation } from "../src/index.mjs";
import { Status } from "../src/core/status.mjs";
import { createMockAsc, readyToPrepareRoutes, testCredentials, VERSION_ID, APP_INFO_ID } from "./helpers/mock-asc.mjs";

const BASE = {
  name: "Test App",
  description: "A test app.",
  keywords: "test,app",
  supportUrl: "https://example.com/support",
  privacyPolicyUrl: "https://example.com/privacy",
};

// ── resolution ────────────────────────────────────────────────────────────────

test("a flat config is one locale", () => {
  const entries = resolveLocales({ locale: "en-US", metadata: BASE });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].locale, "en-US");
  assert.equal(entries[0].primary, true);
  assert.equal(entries[0].metadata.description, "A test app.");
});

test("locales inherit from metadata and override it", () => {
  const entries = resolveLocales({
    locale: "en-US",
    metadata: BASE,
    locales: { "en-US": {}, tr: { name: "Deneme", description: "Bir deneme." } },
  });
  const tr = entries.find((e) => e.locale === "tr");
  assert.ok(tr);
  assert.equal(tr.metadata.name, "Deneme", "the override wins");
  assert.equal(tr.metadata.keywords, "test,app", "and everything else is inherited");
  assert.equal(tr.primary, false);
});

test("the primary locale is first, even when listed last", () => {
  const entries = resolveLocales({ locale: "tr", metadata: BASE, locales: { "en-US": {}, tr: {} } });
  assert.equal(entries[0].locale, "tr");
  assert.equal(primaryLocale({ locale: "tr", locales: { "en-US": {}, tr: {} } }), "tr");
});

test("a primary locale missing from `locales` is still included", () => {
  // Almost certainly a mistake, but writing nothing for it would be worse.
  const codes = localeCodes({ locale: "en-US", metadata: BASE, locales: { tr: {} } });
  assert.deepEqual(codes, ["en-US", "tr"]);
});

// ── validation ────────────────────────────────────────────────────────────────

test("each locale must be complete, and the finding names the key you would edit", () => {
  const { findings } = validateConfig(
    {
      locale: "en-US",
      metadata: { name: "A", supportUrl: "https://e.com", privacyPolicyUrl: "https://e.com/p" },
      locales: { "en-US": { description: "d", keywords: "k" }, tr: { description: "açıklama" } },
    },
    { needs: ["metadata"] },
  );
  const ids = findings.map((f) => f.id);
  assert.deepEqual(ids, ["config.locales.tr.keywords.missing"], "en-US is complete; tr inherits all but keywords");
});

test("a single-locale config still reports the flat key, not a nested one", () => {
  const { findings } = validateConfig({ locale: "en-US", metadata: { name: "A" } }, { needs: ["metadata"] });
  assert.ok(
    findings.every((f) => f.id.startsWith("config.metadata.")),
    findings.map((f) => f.id).join(", "),
  );
});

test("the schema validates inside a locale override, and catches a bad locale key", () => {
  const typo = validateConfig({ locale: "en-US", locales: { tr: { descriptionn: "x" } } });
  assert.ok(typo.findings.some((f) => f.id === "config.locales.tr.descriptionn.unknown"));

  const badKey = validateConfig({ locale: "en-US", locales: { "Turkish!": {} } });
  assert.ok(badKey.findings.some((f) => f.id === "config.locales.Turkish!.propertyNames"));
});

// ── the operation ─────────────────────────────────────────────────────────────

test("metadata writes every configured locale, not only the primary", async () => {
  const root = mkdtempSync(join(tmpdir(), "asr-loc-"));
  writeFileSync(
    join(root, "appstore.config.json"),
    JSON.stringify({
      locale: "en-US",
      metadata: BASE,
      locales: { "en-US": {}, tr: { name: "Deneme", description: "Bir deneme." } },
    }),
  );

  // Two localizations exist on the version, one per locale.
  const routes = {
    ...readyToPrepareRoutes(),
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionLocalizations`]: {
      data: [
        { type: "appStoreVersionLocalizations", id: "vl-en", attributes: { locale: "en-US" } },
        { type: "appStoreVersionLocalizations", id: "vl-tr", attributes: { locale: "tr" } },
      ],
    },
    [`GET /v1/appInfos/${APP_INFO_ID}/appInfoLocalizations`]: {
      data: [
        { type: "appInfoLocalizations", id: "il-en", attributes: { locale: "en-US" } },
        { type: "appInfoLocalizations", id: "il-tr", attributes: { locale: "tr" } },
      ],
    },
    "GET /v1/appStoreVersionLocalizations/:id": { data: { id: "x", attributes: {} } },
    "GET /v1/appInfoLocalizations/:id": { data: { id: "x", attributes: {} } },
    "PATCH /v1/appStoreVersionLocalizations/:id": { status: 204, body: {} },
    "PATCH /v1/appInfoLocalizations/:id": { status: 204, body: {} },
  };

  const mock = createMockAsc({ routes, strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config: join(root, "appstore.config.json"),
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: root },
  });

  const res = await runOperation("metadata", ctx);

  assert.equal(res.status, Status.CHANGED);
  assert.deepEqual(res.details.locales, ["en-US", "tr"]);
  const patched = mock.mutations().map((m) => m.pathname);
  // The whole point: the second locale is written too. It used to be left empty,
  // which is what Apple rejects.
  assert.ok(patched.includes("/v1/appStoreVersionLocalizations/vl-tr"), patched.join(", "));
  assert.ok(patched.includes("/v1/appInfoLocalizations/il-tr"), patched.join(", "));

  const tr = mock.mutations().find((m) => m.pathname === "/v1/appInfoLocalizations/il-tr");
  assert.ok(tr);
  assert.equal(tr.body.data.attributes.name, "Deneme");
});

// ── the report ────────────────────────────────────────────────────────────────

test("the report names which locale is incomplete", () => {
  const snapshot = {
    generatedAt: "2026-09-05T00:00:00.000Z",
    app: { id: "1", attributes: { name: "T", contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT" } },
    version: {
      id: "v1",
      attributes: { versionString: "1.1", appStoreState: "PREPARE_FOR_SUBMISSION", copyright: "2026" },
    },
    versions: [
      { id: "v1", attributes: {} },
      { id: "v0", attributes: {} },
    ],
    build: { id: "b", attributes: { version: "7", processingState: "VALID" } },
    latestBuilds: [],
    appInfo: {
      id: "i",
      relationships: { primaryCategory: { data: { id: "X" } }, ageRatingDeclaration: { data: { id: "a" } } },
    },
    localizations: [
      {
        id: "l1",
        detailed: true,
        attributes: { locale: "en-US", description: "d", keywords: "k", supportUrl: "https://e.com" },
      },
      { id: "l2", detailed: true, attributes: { locale: "tr", description: "d" } },
    ],
    screenshotSets: [
      { id: "s", locale: "en-US", displayType: "APP_IPHONE_67", screenshots: [{ id: "x", state: "COMPLETE" }] },
    ],
    pricing: { hasSchedule: true },
    subscriptions: [],
    reviewDetail: {
      attributes: { contactFirstName: "A", contactLastName: "B", contactPhone: "1", contactEmail: "a@e.com" },
    },
    submission: null,
    locale: "en-US",
    locales: ["en-US", "tr"],
    errors: [],
  };

  const report = buildReport({ snapshot, config: { locale: "en-US", locales: { "en-US": {}, tr: {} } } });
  const ids = report.findings.map((f) => f.id);
  assert.ok(ids.includes("metadata.keywords.missing.tr"), ids.join(", "));
  assert.ok(ids.includes("metadata.supportUrl.missing.tr"));
  assert.ok(!ids.includes("metadata.keywords.missing.en-US"), "en-US is complete");
  assert.equal(report.verdict, "blocked");
});

test("locales present in App Store Connect but absent from the config are surfaced", () => {
  const snapshot = {
    generatedAt: "x",
    app: { id: "1", attributes: { contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT" } },
    version: {
      id: "v1",
      attributes: { versionString: "1.0", appStoreState: "PREPARE_FOR_SUBMISSION", copyright: "c" },
    },
    versions: [{ id: "v1", attributes: {} }],
    build: { id: "b", attributes: {} },
    latestBuilds: [],
    appInfo: {
      id: "i",
      relationships: { primaryCategory: { data: { id: "X" } }, ageRatingDeclaration: { data: { id: "a" } } },
    },
    localizations: [
      {
        id: "l1",
        detailed: true,
        attributes: { locale: "en-US", description: "d", keywords: "k", supportUrl: "https://e.com" },
      },
      { id: "l2", detailed: false, attributes: { locale: "de-DE" } },
    ],
    screenshotSets: [
      { id: "s", locale: "en-US", displayType: "APP_IPHONE_67", screenshots: [{ id: "x", state: "COMPLETE" }] },
    ],
    pricing: { hasSchedule: true },
    subscriptions: [],
    reviewDetail: {
      attributes: { contactFirstName: "A", contactLastName: "B", contactPhone: "1", contactEmail: "a@e.com" },
    },
    submission: null,
    locale: "en-US",
    locales: ["en-US"],
    errors: [],
  };
  const report = buildReport({ snapshot, config: { locale: "en-US" } });
  const f = report.findings.find((x) => x.id === "metadata.locale.unmanaged");
  assert.ok(f, "an unmanaged locale must not look accounted for");
  assert.match(f.detail, /de-DE/);
});

// ── screenshots across display types and locales ──────────────────────────────

test("screenshot sets expand across display types and locales", async () => {
  const { mkdirSync } = await import("node:fs");
  const { resolveScreenshotSets, declaredDisplayTypes } = await import("../src/core/screenshots.mjs");

  const root = mkdtempSync(join(tmpdir(), "asr-shots-"));
  for (const d of ["iphone", "iphone/tr", "ipad"]) mkdirSync(join(root, d), { recursive: true });
  for (const f of ["iphone/01.png", "iphone/tr/01.png", "ipad/01.png"]) writeFileSync(join(root, f), "x");

  const config = {
    locale: "en-US",
    locales: { "en-US": {}, tr: {} },
    screenshots: {
      sets: [
        { displayType: "APP_IPHONE_67", dir: "./iphone" },
        { displayType: "APP_IPAD_PRO_3GEN_129", dir: "./ipad" },
      ],
    },
  };
  const resolve = (p) => join(root, p);
  const { sets } = resolveScreenshotSets(config, resolve, ["en-US", "tr"]);

  assert.deepEqual(
    sets.map((s) => `${s.displayType}/${s.locale}`),
    ["APP_IPHONE_67/en-US", "APP_IPHONE_67/tr", "APP_IPAD_PRO_3GEN_129/en-US", "APP_IPAD_PRO_3GEN_129/tr"],
  );
  // A locale subdirectory overrides the base directory for that locale only.
  const dirOf = (dt, locale) => {
    const found = sets.find((s) => s.displayType === dt && s.locale === locale);
    assert.ok(found, `${dt}/${locale} was not resolved`);
    return found.dir;
  };
  assert.equal(dirOf("APP_IPHONE_67", "tr"), join(root, "iphone/tr"));
  assert.equal(dirOf("APP_IPHONE_67", "en-US"), join(root, "iphone"));
  // iPad has no per-locale subdirectory, so both locales share the base one.
  assert.equal(
    sets.filter((s) => s.displayType === "APP_IPAD_PRO_3GEN_129").every((s) => s.dir === join(root, "ipad")),
    true,
  );

  assert.deepEqual(declaredDisplayTypes(config), ["APP_IPHONE_67", "APP_IPAD_PRO_3GEN_129"]);
  assert.deepEqual(declaredDisplayTypes({ screenshots: { dir: "./x" } }), ["APP_IPHONE_67"]);
});

test("a display type with no local files is reported, not silently skipped", async () => {
  const { resolveScreenshotSets } = await import("../src/core/screenshots.mjs");
  const root = mkdtempSync(join(tmpdir(), "asr-shots2-"));
  const { missing } = resolveScreenshotSets(
    { screenshots: { sets: [{ displayType: "APP_IPAD_PRO_129", dir: "./nope" }] } },
    (p) => join(root, p),
    ["en-US"],
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].displayType, "APP_IPAD_PRO_129");
});
