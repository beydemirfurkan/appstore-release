import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createContext } from "../src/core/context.mjs";
import { runOperation } from "../src/index.mjs";
import { OPERATIONS, PIPELINE, operationIds } from "../src/ops/registry.mjs";
import { Status } from "../src/core/status.mjs";
import { createMockAsc, readyToPrepareRoutes, testCredentials, APP_ID } from "./helpers/mock-asc.mjs";

/** The smallest file that is a structurally valid 1x1 PNG. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A project directory with a config and the assets it points at. */
function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "asr-proj-"));
  mkdirSync(join(root, "assets/screenshots"), { recursive: true });
  writeFileSync(join(root, "assets/screenshots/01.png"), PNG_1X1);
  writeFileSync(join(root, "assets/paywall.png"), PNG_1X1);
  const config = {
    bundleId: "com.example.test",
    locale: "en-US",
    metadata: {
      name: "Test App",
      subtitle: "Testing",
      description: "A test app.",
      keywords: "test,app",
      supportUrl: "https://example.com/support",
      privacyPolicyUrl: "https://example.com/privacy",
      copyright: "2026 Example",
    },
    category: { primary: "PRODUCTIVITY" },
    price: "free",
    review: {
      contactFirstName: "Ada",
      contactLastName: "Lovelace",
      contactPhone: "+1 555 0100",
      contactEmail: "ada@example.com",
    },
    screenshots: { displayType: "APP_IPHONE_67", dir: "./assets/screenshots" },
    credentials: { outputDir: "./secrets" },
    subscription: {
      productId: "com.example.pro",
      priceTerritory: "USA",
      priceAmount: 4.99,
      reviewScreenshot: "./assets/paywall.png",
    },
  };
  writeFileSync(join(root, "appstore.config.json"), JSON.stringify(config, null, 2));
  return { root, configPath: join(root, "appstore.config.json") };
}

async function contextFor({ dryRun = false, routes = readyToPrepareRoutes() } = {}) {
  const { root, configPath } = makeProject();
  const mock = createMockAsc({ routes, strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config: configPath,
    dryRun,
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: root },
  });
  return { ctx, mock, root };
}

// ── the contract every operation must satisfy ─────────────────────────────────

test("every operation declares a well-formed meta", () => {
  for (const id of operationIds()) {
    const { meta, run } = OPERATIONS[id];
    assert.equal(meta.id, id, `${id}: meta.id must match its registry key`);
    assert.ok(meta.title, `${id}: needs a title`);
    assert.ok(["build", "listing", "submit"].includes(meta.phase), `${id}: bad phase ${meta.phase}`);
    assert.ok(Array.isArray(meta.needs), `${id}: needs must be an array`);
    assert.equal(typeof run, "function", `${id}: must export run()`);
    if (meta.destructive || meta.irreversible) {
      assert.equal(meta.mutates, true, `${id}: destructive implies mutating`);
    }
  }
});

test("the pipeline only names operations that exist and mutate", () => {
  for (const id of PIPELINE) {
    assert.ok(OPERATIONS[id], `pipeline names unknown operation ${id}`);
    assert.equal(OPERATIONS[id].meta.mutates, true, `${id} is in the pipeline but mutates nothing`);
  }
});

// ── dry run ───────────────────────────────────────────────────────────────────

test("no mutating operation sends a write while dry running", async () => {
  const mutating = operationIds().filter((id) => OPERATIONS[id].meta.mutates);
  assert.ok(mutating.length >= 10, "expected most operations to mutate");

  for (const id of mutating) {
    const { ctx, mock, root } = await contextFor({ dryRun: true });
    const before = readdirSync(root).sort();

    await runOperation(id, ctx, id === "submit" ? { submit: true } : {});

    const writes = mock.mutations();
    assert.deepEqual(
      writes.map((w) => `${w.method} ${w.pathname}`),
      [],
      `${id} sent ${writes.length} write(s) under --dry-run`,
    );
    assert.deepEqual(readdirSync(root).sort(), before, `${id} wrote to the filesystem under --dry-run`);
  }
});

test("dry run reports PLANNED rather than claiming a change it did not make", async () => {
  const { ctx } = await contextFor({ dryRun: true });
  const res = await runOperation("content-rights", ctx);
  assert.notEqual(res.status, Status.CHANGED);
  /** @type {string[]} */
  const acceptable = [Status.PLANNED, Status.OK, Status.SKIPPED];
  assert.ok(acceptable.includes(res.status), `got ${res.status}`);
});

// ── needs enforcement ─────────────────────────────────────────────────────────

test("a missing config key stops the operation before any network call", async () => {
  const mock = createMockAsc({ routes: readyToPrepareRoutes(), strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config: { locale: "en-US" }, // nothing else
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: process.cwd() },
  });

  const res = await runOperation("metadata", ctx);
  assert.equal(res.status, Status.ERROR);
  assert.equal(mock.calls.length, 0, "it should not have called App Store Connect at all");
  assert.ok(res.findings.some((f) => f.id === "config.metadata.description.missing"));
});

test("credentials is no longer exempt from config loading", async () => {
  // cli.mjs used to skip the config for `credentials`, which then always failed
  // on config.bundleId. meta.needs makes the requirement explicit instead.
  assert.deepEqual(OPERATIONS.credentials.meta.needs, ["credentials"]);
});

// ── --build, the flag that was documented but never parsed ────────────────────

test("attach-build honours an explicit build version", async () => {
  const routes = {
    ...readyToPrepareRoutes(),
    "GET /v1/builds": ({ url }) => ({
      data: [
        {
          type: "builds",
          id: `build-for-${url.searchParams.get("filter[version]") ?? "latest"}`,
          attributes: { version: "9" },
        },
      ],
    }),
    [`PATCH /v1/appStoreVersions/ver-1/relationships/build`]: { status: 204, body: {} },
  };
  const mock = createMockAsc({ routes, strict: false });
  const { configPath, root } = makeProject();
  const ctx = await createContext({
    credentials: testCredentials(),
    config: configPath,
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: root },
  });

  await runOperation("attach-build", ctx, { build: "9" });
  const asked = mock.calls.find((c) => c.pathname === "/v1/builds");
  assert.ok(asked, "attach-build never queried /v1/builds");
  assert.ok(asked.path.includes("filter%5Bversion%5D=9") || asked.path.includes("filter[version]=9"), asked.path);
});

// ── path resolution ───────────────────────────────────────────────────────────

test("relative asset paths resolve against the config, not the process cwd", async () => {
  const { ctx, root } = await contextFor();
  assert.equal(ctx.projectRoot, root);
  assert.equal(ctx.resolvePath("./assets/screenshots"), join(root, "assets/screenshots"));
});
