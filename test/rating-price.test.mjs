import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDeclaration,
  isFourPlus,
  describeDeclaration,
  CONTENT_DIMENSIONS,
  BEHAVIOURAL_FLAGS,
} from "../src/core/age-rating.mjs";
import { nearestPricePoint, resolvePrice } from "../src/core/price.mjs";
import { validateConfig } from "../src/core/requirements.mjs";
import { createContext } from "../src/core/context.mjs";
import { runOperation } from "../src/index.mjs";
import { Status } from "../src/core/status.mjs";
import { createMockAsc, readyToPrepareRoutes, testCredentials, APP_ID } from "./helpers/mock-asc.mjs";

// ── age rating ────────────────────────────────────────────────────────────────

test("an empty declaration is a complete 4+ one", () => {
  const d = buildDeclaration();
  assert.equal(isFourPlus(d), true);
  // Apple 409s a partial declaration, so every key must be present every time.
  for (const key of [...CONTENT_DIMENSIONS, ...BEHAVIOURAL_FLAGS]) {
    assert.ok(key in d, `${key} missing from the declaration`);
  }
  assert.equal(d.ageAssurance, false, "ageAssurance is required; omitting it returns 409");
  assert.equal(d.kidsAgeBand, null);
});

test("config values override the defaults and everything else stays complete", () => {
  const d = buildDeclaration({ violenceRealistic: "INFREQUENT_OR_MILD", gambling: true });
  assert.equal(d.violenceRealistic, "INFREQUENT_OR_MILD");
  assert.equal(d.gambling, true);
  assert.equal(d.horrorOrFearThemes, "NONE");
  assert.equal(isFourPlus(d), false);
  assert.match(describeDeclaration(d), /violenceRealistic=INFREQUENT_OR_MILD/);
});

test("age-rating writes the config's declaration, and is a no-op when it matches", async () => {
  const declaration = buildDeclaration({ gambling: true });
  const routes = {
    ...readyToPrepareRoutes(),
    "GET /v1/ageRatingDeclarations/age-1": {
      data: { type: "ageRatingDeclarations", id: "age-1", attributes: declaration },
    },
    "PATCH /v1/ageRatingDeclarations/age-1": { status: 204, body: {} },
    [`GET /v1/apps/${APP_ID}/appInfos`]: {
      data: [
        {
          type: "appInfos",
          id: "info-1",
          attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" },
          relationships: { ageRatingDeclaration: { data: { type: "ageRatingDeclarations", id: "age-1" } } },
        },
      ],
      included: [],
    },
  };

  const same = createMockAsc({ routes, strict: false });
  const ctxSame = await createContext({
    credentials: testCredentials(),
    config: { locale: "en-US", ageRating: { gambling: true } },
    fetchImpl: same.fetchImpl,
    runtime: { env: {}, cwd: process.cwd() },
  });
  const resSame = await runOperation("age-rating", ctxSame);
  assert.equal(resSame.status, Status.OK, resSame.message);
  assert.deepEqual(same.mutations(), [], "it used to PATCH unconditionally and always report a change");

  const diff = createMockAsc({ routes, strict: false });
  const ctxDiff = await createContext({
    credentials: testCredentials(),
    config: { locale: "en-US", ageRating: { violenceRealistic: "FREQUENT_OR_INTENSE" } },
    fetchImpl: diff.fetchImpl,
    runtime: { env: {}, cwd: process.cwd() },
  });
  const resDiff = await runOperation("age-rating", ctxDiff);
  assert.equal(resDiff.status, Status.CHANGED);
  const patch = diff.mutations().find((m) => m.method === "PATCH");
  assert.ok(patch);
  assert.equal(patch.body.data.attributes.violenceRealistic, "FREQUENT_OR_INTENSE");
  assert.equal(patch.body.data.attributes.gambling, false, "unset keys are still sent, defaulted");
});

test("ageRating4Plus:false still means leave it alone", async () => {
  const mock = createMockAsc({ routes: readyToPrepareRoutes(), strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config: { locale: "en-US", ageRating4Plus: false },
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: process.cwd() },
  });
  assert.equal((await runOperation("age-rating", ctx)).status, Status.SKIPPED);
});

// ── price ─────────────────────────────────────────────────────────────────────

test("resolvePrice understands both the shorthand and the object", () => {
  assert.deepEqual(resolvePrice("free"), { free: true, amount: 0, baseTerritory: "USA" });
  assert.deepEqual(resolvePrice({ amount: 4.99 }), { free: false, amount: 4.99, baseTerritory: "USA" });
  assert.deepEqual(resolvePrice({ amount: 9.99, baseTerritory: "TUR" }), {
    free: false,
    amount: 9.99,
    baseTerritory: "TUR",
  });
  assert.equal(resolvePrice(undefined), null);
  assert.equal(resolvePrice("cheap"), null);
});

test("the nearest price point wins, since Apple takes a point and not an amount", () => {
  const points = [
    { id: "a", attributes: { customerPrice: "0.00" } },
    { id: "b", attributes: { customerPrice: "4.99" } },
    { id: "c", attributes: { customerPrice: "9.99" } },
  ];
  assert.equal(nearestPricePoint(points, 5)?.id, "b");
  assert.equal(nearestPricePoint(points, 0)?.id, "a");
  assert.equal(nearestPricePoint(points, 100)?.id, "c");
  assert.equal(nearestPricePoint([], 5), null);
});

test("a paid price is schema-valid and a bogus one is not", () => {
  assert.equal(validateConfig({ locale: "en-US", price: { amount: 4.99 } }).valid, true);
  assert.equal(validateConfig({ locale: "en-US", price: "free" }).valid, true);

  const missing = validateConfig({ locale: "en-US", price: { baseTerritory: "USA" } });
  assert.ok(
    missing.findings.some((f) => f.id === "config.price.amount.required"),
    "the message must name the amount",
  );
  assert.ok(validateConfig({ locale: "en-US", price: "cheap" }).findings.some((f) => f.id === "config.price.enum"));
});

test("pricing sets a paid tier, and skips when the schedule already matches", async () => {
  const pricePoints = {
    data: [
      { type: "appPricePoints", id: "pp-free", attributes: { customerPrice: "0.00" } },
      { type: "appPricePoints", id: "pp-499", attributes: { customerPrice: "4.99" } },
    ],
  };
  const root = mkdtempSync(join(tmpdir(), "asr-price-"));
  writeFileSync(
    join(root, "appstore.config.json"),
    JSON.stringify({ locale: "en-US", metadata: { copyright: "2026 X" }, price: { amount: 4.99 } }),
  );

  const routes = {
    ...readyToPrepareRoutes(),
    [`GET /v1/apps/${APP_ID}/appPricePoints`]: pricePoints,
    [`GET /v1/appPriceSchedules/${APP_ID}/manualPrices`]: { data: [] },
    "POST /v1/appPriceSchedules": { data: { type: "appPriceSchedules", id: "sched-1" } },
    "GET /v1/appStoreVersions/ver-1": {
      data: { type: "appStoreVersions", id: "ver-1", attributes: { copyright: "2026 X" } },
    },
  };
  const mock = createMockAsc({ routes, strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config: join(root, "appstore.config.json"),
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: root },
  });

  const res = await runOperation("pricing", ctx);
  assert.equal(res.status, Status.CHANGED, res.message);
  const post = mock.mutations().find((m) => m.pathname === "/v1/appPriceSchedules");
  assert.ok(post, "a paid app used to be impossible: only price === 'free' was handled");
  assert.equal(post.body.included[0].relationships.appPricePoint.data.id, "pp-499");

  // Already on that point: nothing to send.
  const settled = createMockAsc({
    routes: {
      ...routes,
      [`GET /v1/appPriceSchedules/${APP_ID}/manualPrices`]: {
        data: [{ type: "appPrices", id: "ap-1" }],
        included: [{ type: "appPricePoints", id: "pp-499", attributes: { customerPrice: "4.99" } }],
      },
    },
    strict: false,
  });
  const ctx2 = await createContext({
    credentials: testCredentials(),
    config: join(root, "appstore.config.json"),
    fetchImpl: settled.fetchImpl,
    runtime: { env: {}, cwd: root },
  });
  const res2 = await runOperation("pricing", ctx2);
  assert.equal(res2.status, Status.OK, res2.message);
  assert.deepEqual(settled.mutations(), []);
});
