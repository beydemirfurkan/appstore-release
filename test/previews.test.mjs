// App previews: videos through the App Asset Library, checked locally first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../src/cli.mjs";
import { createFakeAsc } from "./helpers/fake-asc.mjs";
import { writeWellnessProject } from "./helpers/fixture-project.mjs";
import { testPrivateKey } from "./helpers/mock-asc.mjs";
import { minimalMp4, readVideoHeader } from "../src/asc/video.mjs";
import { durationSeconds } from "../src/asc/asset-library.mjs";

/** @param {Record<string, { width: number, height: number, durationSeconds: number }>} videos */
function project(videos, previews = { dir: "./previews" }) {
  const root = mkdtempSync(join(tmpdir(), "asr-previews-"));
  writeWellnessProject(root);
  const path = join(root, "appstore.config.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), previews }));
  for (const [file, spec] of Object.entries(videos)) {
    mkdirSync(join(root, "previews", file.includes("/") ? file.split("/")[0] : ""), { recursive: true });
    writeFileSync(join(root, "previews", file), minimalMp4(spec));
  }
  const fake = createFakeAsc();
  const env = {
    ASC_KEY_ID: "ABCDE12345",
    ASC_ISSUER_ID: "69a6de00-0000-0000-0000-000000000000",
    ASC_P8: testPrivateKey(),
    ASC_APP_ID: "1234567890",
    APPSTORE_RELEASE_STATE_DIR: mkdtempSync(join(tmpdir(), "asr-state-")),
  };
  const run = async (/** @type {string[]} */ ...argv) => {
    const out = [];
    const io = {
      stdout: { write: (s) => out.push(s) },
      stderr: { write: () => {} },
      env,
      cwd: root,
      fetchImpl: fake.fetchImpl,
    };
    return { code: await main([...argv, "--json"], io), json: JSON.parse(out.join("")) };
  };
  return { root, fake, run };
}

const iphone = { width: 886, height: 1920, durationSeconds: 20 };

test("the video reader: size and length from the file, null for anything else", () => {
  const dir = mkdtempSync(join(tmpdir(), "asr-video-"));
  writeFileSync(join(dir, "a.mp4"), minimalMp4({ width: 1200, height: 1600, durationSeconds: 29.5, padding: 4096 }));
  assert.deepEqual(readVideoHeader(join(dir, "a.mp4")), { width: 1200, height: 1600, durationSeconds: 29.5 });
  writeFileSync(join(dir, "b.mp4"), "not a video");
  assert.equal(readVideoHeader(join(dir, "b.mp4")), null);
  assert.equal(readVideoHeader(join(dir, "missing.mp4")), null);
});

test("ISO 8601 durations, and nothing rejected for a format it cannot read", () => {
  assert.equal(durationSeconds("PT30S"), 30);
  assert.equal(durationSeconds("PT1M5.5S"), 65.5);
  assert.equal(durationSeconds(15), 15);
  assert.equal(durationSeconds("thirty"), null);
  assert.equal(durationSeconds(undefined), null);
});

test("previews are placed once, in their device group, and screenshots do not mistake them for orphans", async () => {
  const { fake, run } = project(
    { "1-intro.mp4": iphone, "2-features.mp4": iphone },
    { dir: "./previews", posterFrame: "00:00:05:00" },
  );
  const first = await run("previews");
  assert.equal(first.json.results[0].status, "changed", first.json.results[0].message);
  const placements = fake.all("appAssetLibraryPlacements").filter((p) => p.attributes.placementType === "APP_PREVIEW");
  assert.equal(placements.length, 2);
  assert.ok(placements.every((p) => p.attributes.placementGroup === "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE"));
  assert.ok(placements.every((p) => p.attributes.mediaType === "VIDEO"));
  assert.ok(fake.all("appAssetLibraryVideos").every((v) => v.attributes.previewFrameTimeCode === "00:00:05:00"));

  assert.equal((await run("previews")).json.results[0].status, "ok", "nothing uploaded twice");

  await run("screenshots", "--prune");
  assert.equal(
    fake.all("appAssetLibraryPlacements").filter((p) => p.attributes.placementType === "APP_PREVIEW").length,
    2,
    "pruning screenshots leaves previews alone",
  );
  assert.deepEqual(fake.unhandled, []);
});

test("a preview of the wrong size or length is refused before any upload", async () => {
  const { fake, run } = project({
    "a.mp4": { width: 1080, height: 1920, durationSeconds: 20 },
    "b.mp4": { ...iphone, durationSeconds: 10 },
  });
  const res = await run("previews");
  assert.equal(res.json.results[0].status, "error");
  assert.ok(res.json.findings.some((f) => /No app preview size is 1080×1920/.test(f.title)));
  assert.ok(res.json.findings.some((f) => /10 seconds; previews run 15–30 seconds/.test(f.title)));
  assert.equal(fake.all("appAssetLibraryVideos").length, 0);
});

test("more previews than Apple allows in a group is refused", async () => {
  const { fake, run } = project({ "1.mp4": iphone, "2.mp4": iphone, "3.mp4": iphone, "4.mp4": iphone });
  const res = await run("previews");
  assert.ok(
    res.json.findings.some((f) =>
      /4 previews for IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE, but Apple allows 3/.test(f.title),
    ),
  );
  assert.equal(fake.all("appAssetLibraryVideos").length, 0);
});

test("previews are a release step, skipped when the config has none", async () => {
  const root = mkdtempSync(join(tmpdir(), "asr-previews-none-"));
  writeWellnessProject(root);
  const fake = createFakeAsc();
  const out = [];
  await main(["release", "--json"], {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: () => {} },
    env: {
      ASC_KEY_ID: "ABCDE12345",
      ASC_ISSUER_ID: "69a6de00-0000-0000-0000-000000000000",
      ASC_P8: testPrivateKey(),
      ASC_APP_ID: "1234567890",
      APPSTORE_RELEASE_STATE_DIR: mkdtempSync(join(tmpdir(), "asr-state-")),
    },
    cwd: root,
    fetchImpl: fake.fetchImpl,
  });
  const json = JSON.parse(out.join(""));
  assert.equal(json.results.find((r) => r.id === "previews")?.status, "skipped");
});
