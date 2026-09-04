import { test } from "node:test";
import assert from "node:assert/strict";

import { createContext } from "../src/core/context.mjs";
import { runOperation } from "../src/index.mjs";
import { Status } from "../src/core/status.mjs";
import { resolveRelease } from "../src/ops/release-options.mjs";
import { validateConfig } from "../src/core/requirements.mjs";
import { createMockAsc, readyToPrepareRoutes, testCredentials, APP_ID, VERSION_ID } from "./helpers/mock-asc.mjs";

async function ctxFor(routes, config = { locale: "en-US" }) {
  const mock = createMockAsc({ routes, strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config,
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: process.cwd() },
  });
  return { ctx, mock };
}

// ── new-version ───────────────────────────────────────────────────────────────

test("new-version is a no-op when a version is already editable", async () => {
  const { ctx, mock } = await ctxFor(readyToPrepareRoutes());
  const res = await runOperation("new-version", ctx);
  assert.equal(res.status, Status.OK);
  assert.equal(res.details.created, false);
  assert.deepEqual(mock.mutations(), []);
});

test("new-version creates the next version when everything is live", async () => {
  // This is the case the snapshot deliberately refuses to work around: it will
  // not target a live version, so without this operation there was no way out.
  const routes = {
    ...readyToPrepareRoutes(),
    [`GET /v1/apps/${APP_ID}/appStoreVersions`]: {
      data: [
        {
          type: "appStoreVersions",
          id: "v2",
          attributes: { versionString: "1.4", appStoreState: "READY_FOR_DISTRIBUTION" },
        },
        {
          type: "appStoreVersions",
          id: "v1",
          attributes: { versionString: "1.3", appStoreState: "READY_FOR_DISTRIBUTION" },
        },
      ],
    },
    "POST /v1/appStoreVersions": ({ call }) => ({
      data: {
        type: "appStoreVersions",
        id: "v3",
        attributes: { versionString: call.body.data.attributes.versionString },
      },
    }),
  };
  const { ctx, mock } = await ctxFor(routes);
  const res = await runOperation("new-version", ctx);

  assert.equal(res.status, Status.CHANGED);
  assert.equal(res.details.versionString, "1.5", "it increments the newest, not the first returned");
  const post = mock.mutations().find((m) => m.pathname === "/v1/appStoreVersions");
  assert.ok(post);
  assert.equal(post.body.data.attributes.platform, "IOS");
});

test("new-version takes an explicit number", async () => {
  const routes = {
    ...readyToPrepareRoutes(),
    [`GET /v1/apps/${APP_ID}/appStoreVersions`]: {
      data: [
        {
          type: "appStoreVersions",
          id: "v1",
          attributes: { versionString: "1.0", appStoreState: "READY_FOR_DISTRIBUTION" },
        },
      ],
    },
    "POST /v1/appStoreVersions": { data: { type: "appStoreVersions", id: "v9", attributes: {} } },
  };
  const { ctx, mock } = await ctxFor(routes);
  await runOperation("new-version", ctx, { version: "2.0" });
  const post = mock.mutations().find((m) => m.pathname === "/v1/appStoreVersions");
  assert.ok(post);
  assert.equal(post.body.data.attributes.versionString, "2.0");
});

// ── release timing ────────────────────────────────────────────────────────────

test("resolveRelease reads the new block and the deprecated key", () => {
  assert.equal(resolveRelease({}), null);
  assert.deepEqual(resolveRelease({ release: { type: "MANUAL" } }), {
    type: "MANUAL",
    earliestDate: null,
    phased: false,
    legacy: false,
  });
  const legacy = resolveRelease({ review: { releaseType: "AFTER_APPROVAL" } });
  assert.ok(legacy);
  assert.equal(legacy.type, "AFTER_APPROVAL");
  assert.equal(legacy.legacy, true, "the old key still works, but is flagged");
});

test("release-options writes the release type — the setting that used to do nothing", async () => {
  const routes = {
    ...readyToPrepareRoutes(),
    [`GET /v1/appStoreVersions/${VERSION_ID}`]: {
      data: { type: "appStoreVersions", id: VERSION_ID, attributes: { releaseType: "AFTER_APPROVAL" } },
    },
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionPhasedRelease`]: { status: 404, body: { errors: [] } },
    [`PATCH /v1/appStoreVersions/${VERSION_ID}`]: { status: 204, body: {} },
  };
  const { ctx, mock } = await ctxFor(routes, { locale: "en-US", release: { type: "MANUAL" } });

  const res = await runOperation("release-options", ctx);
  assert.equal(res.status, Status.CHANGED);
  const patch = mock.mutations().find((m) => m.method === "PATCH");
  assert.ok(patch);
  assert.equal(patch.body.data.attributes.releaseType, "MANUAL");
});

test("release-options is a no-op when the timing already matches", async () => {
  const routes = {
    ...readyToPrepareRoutes(),
    [`GET /v1/appStoreVersions/${VERSION_ID}`]: {
      data: { type: "appStoreVersions", id: VERSION_ID, attributes: { releaseType: "MANUAL" } },
    },
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionPhasedRelease`]: { status: 404, body: { errors: [] } },
  };
  const { ctx, mock } = await ctxFor(routes, { locale: "en-US", release: { type: "MANUAL" } });
  const res = await runOperation("release-options", ctx);
  assert.equal(res.status, Status.OK);
  assert.deepEqual(mock.mutations(), []);
});

test("SCHEDULED without a date is refused rather than sent", async () => {
  const routes = {
    ...readyToPrepareRoutes(),
    [`GET /v1/appStoreVersions/${VERSION_ID}`]: { data: { type: "appStoreVersions", id: VERSION_ID, attributes: {} } },
  };
  const { ctx, mock } = await ctxFor(routes, { locale: "en-US", release: { type: "SCHEDULED" } });
  const res = await runOperation("release-options", ctx);
  assert.equal(res.status, Status.ERROR);
  assert.match(res.message, /earliestDate/);
  assert.deepEqual(mock.mutations(), []);
});

test("phased release is created and removed to match the config", async () => {
  const off = {
    ...readyToPrepareRoutes(),
    [`GET /v1/appStoreVersions/${VERSION_ID}`]: { data: { type: "appStoreVersions", id: VERSION_ID, attributes: {} } },
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionPhasedRelease`]: { status: 404, body: { errors: [] } },
    "POST /v1/appStoreVersionPhasedReleases": { data: { type: "appStoreVersionPhasedReleases", id: "pr-1" } },
  };
  const { ctx, mock } = await ctxFor(off, { locale: "en-US", release: { phased: true } });
  await runOperation("release-options", ctx);
  assert.ok(mock.mutations().some((m) => m.pathname === "/v1/appStoreVersionPhasedReleases"));

  const on = {
    ...readyToPrepareRoutes(),
    [`GET /v1/appStoreVersions/${VERSION_ID}`]: { data: { type: "appStoreVersions", id: VERSION_ID, attributes: {} } },
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionPhasedRelease`]: {
      data: { type: "appStoreVersionPhasedReleases", id: "pr-1" },
    },
    "DELETE /v1/appStoreVersionPhasedReleases/pr-1": { status: 204, body: {} },
    [`PATCH /v1/appStoreVersions/${VERSION_ID}`]: { status: 204, body: {} },
  };
  const { ctx: ctx2, mock: mock2 } = await ctxFor(on, { locale: "en-US", release: { phased: false, type: "MANUAL" } });
  await runOperation("release-options", ctx2);
  assert.ok(mock2.mutations().some((m) => m.method === "DELETE" && m.pathname.includes("PhasedReleases")));
});

test("the deprecated review.releaseType still works and says so", async () => {
  const routes = {
    ...readyToPrepareRoutes(),
    [`GET /v1/appStoreVersions/${VERSION_ID}`]: { data: { type: "appStoreVersions", id: VERSION_ID, attributes: {} } },
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionPhasedRelease`]: { status: 404, body: { errors: [] } },
    [`PATCH /v1/appStoreVersions/${VERSION_ID}`]: { status: 204, body: {} },
  };
  const { ctx } = await ctxFor(routes, { locale: "en-US", review: { releaseType: "MANUAL" } });
  const res = await runOperation("release-options", ctx);
  assert.equal(res.status, Status.CHANGED);
  assert.ok(res.findings.some((f) => f.id === "config.review.releaseType.deprecated"));
});

test("the release block is schema-valid and a bad type is caught", () => {
  assert.equal(validateConfig({ locale: "en-US", release: { type: "MANUAL", phased: true } }).valid, true);
  const bad = validateConfig({ locale: "en-US", release: { type: "WHENEVER" } });
  assert.ok(bad.findings.some((f) => f.id === "config.release.type.enum"));
});
