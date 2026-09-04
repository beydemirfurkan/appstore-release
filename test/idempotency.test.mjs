import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createContext } from "../src/core/context.mjs";
import { runOperation } from "../src/index.mjs";
import { Status } from "../src/core/status.mjs";
import { createMockAsc, readyToPrepareRoutes, testCredentials, VERSION_LOC_ID } from "./helpers/mock-asc.mjs";

/** Two visually different but structurally valid 1290×2796 PNGs. */
function png(width, height, tag) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt8(8, 16); // bit depth
  ihdr.writeUInt8(2, 17); // colour type: truecolour, no alpha
  return Buffer.concat([sig, ihdr, Buffer.from(`tail-${tag}`)]);
}

function project({ files }) {
  const root = mkdtempSync(join(tmpdir(), "asr-idem-"));
  mkdirSync(join(root, "shots"), { recursive: true });
  const written = [];
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(root, "shots", name);
    writeFileSync(path, bytes);
    written.push({ name, checksum: createHash("md5").update(bytes).digest("hex"), size: bytes.length });
  }
  writeFileSync(
    join(root, "appstore.config.json"),
    JSON.stringify({ locale: "en-US", screenshots: { displayType: "APP_IPHONE_67", dir: "./shots" } }),
  );
  return { root, written };
}

/** Routes where the set already holds exactly these screenshots, COMPLETE. */
function routesWithScreenshots(items) {
  return {
    ...readyToPrepareRoutes(),
    [`GET /v1/appStoreVersionLocalizations/${VERSION_LOC_ID}/appScreenshotSets`]: {
      data: [{ type: "appScreenshotSets", id: "set-1", attributes: { screenshotDisplayType: "APP_IPHONE_67" } }],
    },
    "GET /v1/appScreenshotSets/set-1/appScreenshots": {
      data: items.map((it, i) => ({
        type: "appScreenshots",
        id: `remote-${i}`,
        attributes: {
          fileName: it.name,
          fileSize: it.size,
          sourceFileChecksum: it.checksum,
          assetDeliveryState: { state: it.state ?? "COMPLETE" },
        },
      })),
    },
    "PATCH /v1/appScreenshotSets/set-1/relationships/appScreenshots": { status: 204, body: {} },

    // The full reserve -> upload -> commit dance, so an upload is really exercised.
    "POST /v1/appScreenshots": ({ call }) => ({
      data: {
        type: "appScreenshots",
        id: `new-${call.body.data.attributes.fileName}`,
        attributes: {
          uploadOperations: [
            {
              method: "PUT",
              url: "https://upload.example.com/chunk",
              offset: 0,
              length: call.body.data.attributes.fileSize,
              requestHeaders: [{ name: "Content-Type", value: "image/png" }],
            },
          ],
        },
      },
    }),
    "PUT /chunk": { status: 200, body: {} },
    "PATCH /v1/appScreenshots/:id": { status: 204, body: {} },
  };
}

async function ctxFor(root, routes) {
  const mock = createMockAsc({ routes, strict: false });
  const ctx = await createContext({
    credentials: testCredentials(),
    config: join(root, "appstore.config.json"),
    fetchImpl: mock.fetchImpl,
    runtime: { env: {}, cwd: root },
  });
  return { ctx, mock };
}

test("re-uploading unchanged screenshots uploads nothing and deletes nothing", async () => {
  const { root, written } = project({ files: { "01.png": png(1290, 2796, "a"), "02.png": png(1290, 2796, "b") } });
  const { ctx, mock } = await ctxFor(root, routesWithScreenshots(written));

  const res = await runOperation("screenshots", ctx, { prune: true });

  assert.equal(res.status, Status.OK, res.message);
  assert.equal(res.details.uploaded.length, 0);
  assert.equal(res.details.deleted.length, 0);
  assert.deepEqual(
    mock.mutations().filter((m) => m.method === "DELETE"),
    [],
    "the old code deleted every screenshot on every run",
  );
  assert.deepEqual(
    mock.mutations().filter((m) => m.method === "POST"),
    [],
  );
});

test("only the changed file is uploaded, and the untouched one survives", async () => {
  const { root, written } = project({ files: { "01.png": png(1290, 2796, "a"), "02.png": png(1290, 2796, "b") } });
  // App Store Connect still holds the *old* 02.png.
  const remote = [written[0], { ...written[1], checksum: "stale-checksum" }];
  const { ctx, mock } = await ctxFor(root, routesWithScreenshots(remote));

  const res = await runOperation("screenshots", ctx, { prune: true });

  assert.equal(res.status, Status.CHANGED);
  assert.deepEqual(res.details.uploaded, ["02.png"]);
  assert.equal(res.details.unchanged, 1);
  const deletes = mock.mutations().filter((m) => m.method === "DELETE");
  assert.equal(deletes.length, 1, "only the superseded screenshot should go");
});

test("a screenshot that never finished uploading is replaced, not left to rot", async () => {
  const { root, written } = project({ files: { "01.png": png(1290, 2796, "a") } });
  const remote = [{ ...written[0], state: "UPLOAD_COMPLETE" }];
  const { ctx, mock } = await ctxFor(root, routesWithScreenshots(remote));

  const res = await runOperation("screenshots", ctx, { prune: false });

  assert.deepEqual(res.details.uploaded, ["01.png"]);
  assert.equal(
    mock.mutations().filter((m) => m.method === "DELETE").length,
    1,
    "the stuck one is removed even without prune",
  );
});

test("without prune, an orphan is kept and reported instead of deleted", async () => {
  const { root, written } = project({ files: { "01.png": png(1290, 2796, "a") } });
  const remote = [written[0], { name: "old.png", checksum: "orphan", size: 10 }];
  const { ctx, mock } = await ctxFor(root, routesWithScreenshots(remote));

  const res = await runOperation("screenshots", ctx, { prune: false });

  assert.equal(mock.mutations().filter((m) => m.method === "DELETE").length, 0);
  assert.ok(res.findings.some((f) => f.id === "screenshots.orphans.kept"));
});

test("a wrongly sized PNG is refused before anything is sent", async () => {
  const { root, written } = project({ files: { "01.png": png(800, 600, "small") } });
  const { ctx, mock } = await ctxFor(root, routesWithScreenshots(written));

  const res = await runOperation("screenshots", ctx);

  assert.equal(res.status, Status.ERROR);
  assert.ok(res.findings.some((f) => f.id === "screenshots.dimensions.invalid"));
  assert.equal(mock.calls.length, 0, "it must not reach App Store Connect at all");
});

test("an upload is committed at the /v1 path, or App Store Connect ignores it", async () => {
  // The shipped 1.0.0 sent this PATCH without the /v1 prefix, so every asset
  // stayed reserved and never became visible — a subscription would sit in
  // MISSING_METADATA with nothing in the UI to explain why.
  const { root, written } = project({ files: { "01.png": png(1290, 2796, "a") } });
  const remote = [{ ...written[0], checksum: "stale" }];
  const { ctx, mock } = await ctxFor(root, routesWithScreenshots(remote));

  await runOperation("screenshots", ctx, { prune: true });

  const commit = mock.calls.find((c) => c.method === "PATCH" && c.pathname.startsWith("/v1/appScreenshots/"));
  assert.ok(commit, "the asset was never committed");
  assert.equal(commit.body.data.attributes.uploaded, true);
  assert.match(commit.body.data.attributes.sourceFileChecksum, /^[0-9a-f]{32}$/);
});

test("metadata writes only what differs, and says so honestly", async () => {
  const root = mkdtempSync(join(tmpdir(), "asr-meta-"));
  writeFileSync(
    join(root, "appstore.config.json"),
    JSON.stringify({
      locale: "en-US",
      metadata: {
        name: "Test App",
        subtitle: "Testing",
        description: "A test app.",
        keywords: "test,app",
        supportUrl: "https://example.com/support",
        privacyPolicyUrl: "https://example.com/privacy",
      },
    }),
  );

  // App Store Connect already holds everything except the privacy policy URL.
  const routes = {
    ...readyToPrepareRoutes(),
    "GET /v1/appInfoLocalizations/infoloc-1": {
      data: { type: "appInfoLocalizations", id: "infoloc-1", attributes: { name: "Test App", subtitle: "Testing" } },
    },
    [`GET /v1/appStoreVersionLocalizations/${VERSION_LOC_ID}`]: {
      data: {
        type: "appStoreVersionLocalizations",
        id: VERSION_LOC_ID,
        attributes: {
          description: "A test app.",
          keywords: "test,app",
          supportUrl: "https://example.com/support",
        },
      },
    },
    "PATCH /v1/appInfoLocalizations/infoloc-1": { status: 204, body: {} },
    [`PATCH /v1/appStoreVersionLocalizations/${VERSION_LOC_ID}`]: { status: 204, body: {} },
  };
  const { ctx, mock } = await ctxFor(root, routes);

  const res = await runOperation("metadata", ctx);

  assert.equal(res.status, Status.CHANGED);
  assert.deepEqual(res.details.changed, ["privacyPolicyUrl"], "it used to PATCH every field unconditionally");
  const patches = mock.mutations().filter((m) => m.method === "PATCH");
  assert.equal(patches.length, 1, "the version localization already matched, so it should not have been touched");
  assert.deepEqual(patches[0].body.data.attributes, { privacyPolicyUrl: "https://example.com/privacy" });
});

test("metadata reports OK when App Store Connect already matches the config", async () => {
  const root = mkdtempSync(join(tmpdir(), "asr-meta2-"));
  writeFileSync(
    join(root, "appstore.config.json"),
    JSON.stringify({
      locale: "en-US",
      metadata: {
        name: "Test App",
        description: "A test app.",
        keywords: "test,app",
        supportUrl: "https://example.com/support",
        privacyPolicyUrl: "https://example.com/privacy",
      },
    }),
  );
  const routes = {
    ...readyToPrepareRoutes(),
    "GET /v1/appInfoLocalizations/infoloc-1": {
      data: {
        type: "appInfoLocalizations",
        id: "infoloc-1",
        attributes: { name: "Test App", privacyPolicyUrl: "https://example.com/privacy" },
      },
    },
    [`GET /v1/appStoreVersionLocalizations/${VERSION_LOC_ID}`]: {
      data: {
        type: "appStoreVersionLocalizations",
        id: VERSION_LOC_ID,
        attributes: {
          description: "A test app.",
          keywords: "test,app",
          supportUrl: "https://example.com/support",
        },
      },
    },
  };
  const { ctx, mock } = await ctxFor(root, routes);

  const res = await runOperation("metadata", ctx);

  assert.equal(res.status, Status.OK, res.message);
  assert.deepEqual(mock.mutations(), [], "a no-op run must send nothing at all");
});

test("submit refuses when the readiness verdict is not ready", async () => {
  const root = mkdtempSync(join(tmpdir(), "asr-submit-"));
  writeFileSync(join(root, "appstore.config.json"), JSON.stringify({ locale: "en-US" }));
  const { ctx, mock } = await ctxFor(root, readyToPrepareRoutes());

  const res = await runOperation("submit", ctx, { submit: true });

  assert.equal(res.status, Status.ERROR);
  assert.match(res.message, /not ready to submit/);
  // The point: it declines *before* creating anything, so no review cycle is spent.
  assert.deepEqual(
    mock.mutations().map((m) => `${m.method} ${m.pathname}`),
    [],
  );
});

test("submit --force gets past the gate", async () => {
  const root = mkdtempSync(join(tmpdir(), "asr-submit2-"));
  writeFileSync(join(root, "appstore.config.json"), JSON.stringify({ locale: "en-US" }));
  const routes = {
    ...readyToPrepareRoutes(),
    "GET /v1/reviewSubmissions": { data: [] },
    "POST /v1/reviewSubmissions": { data: { type: "reviewSubmissions", id: "rs-1", attributes: {} } },
    "POST /v1/reviewSubmissionItems": { data: { type: "reviewSubmissionItems", id: "rsi-1" } },
    "PATCH /v1/reviewSubmissions/rs-1": {
      data: { type: "reviewSubmissions", id: "rs-1", attributes: { state: "WAITING_FOR_REVIEW" } },
    },
  };
  const { ctx, mock } = await ctxFor(root, routes);

  await runOperation("submit", ctx, { submit: true, force: true });

  assert.ok(mock.mutations().length > 0, "with --force it must actually try");
});
