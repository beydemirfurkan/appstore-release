// Custom product pages, end to end against the fake App Store Connect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../src/cli.mjs";
import { Exit } from "../src/core/status.mjs";
import { approveCustomPages, createFakeAsc } from "./helpers/fake-asc.mjs";
import { headerOnlyPng, writeWellnessProject } from "./helpers/fixture-project.mjs";
import { testPrivateKey } from "./helpers/mock-asc.mjs";

const ramadan = {
  name: "Ramadan",
  deepLink: "wellness://ramadan",
  locales: { "en-US": { promotionalText: "A calm Ramadan.", screenshots: "./cpp/ramadan" } },
};

function project(pages = [ramadan]) {
  const root = mkdtempSync(join(tmpdir(), "asr-cpp-"));
  writeWellnessProject(root);
  mkdirSync(join(root, "cpp/ramadan"), { recursive: true });
  writeFileSync(join(root, "cpp/ramadan/01.png"), headerOnlyPng(1320, 2868, "r1"));
  writeFileSync(join(root, "cpp/ramadan/02.png"), headerOnlyPng(1320, 2868, "r2"));
  const path = join(root, "appstore.config.json");
  const write = (/** @type {(c: any) => any} */ f) =>
    writeFileSync(path, JSON.stringify(f(JSON.parse(readFileSync(path, "utf8")))));
  write((c) => ({ ...c, customProductPages: pages }));
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
  return { root, fake, run, write };
}

const cppPlacements = (/** @type {any} */ fake) =>
  fake.all("appAssetLibraryPlacements").filter((p) => p.relationships?.appCustomProductPageLocalization);

test("a page is created with its version, text, deep link and screenshots — once", async () => {
  const { fake, run } = project();
  const first = await run("custom-product-pages");
  assert.equal(first.json.results[0].status, "changed", first.json.results[0].message);
  const [page] = fake.all("appCustomProductPages");
  assert.equal(page.attributes.name, "Ramadan");
  const [version] = fake.all("appCustomProductPageVersions");
  assert.equal(version.attributes.deepLink, "wellness://ramadan");
  assert.equal(fake.all("appCustomProductPageLocalizations")[0].attributes.promotionalText, "A calm Ramadan.");
  assert.equal(cppPlacements(fake).length, 2);
  assert.ok(cppPlacements(fake).every((p) => p.attributes.placementGroup === "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE"));

  assert.equal((await run("custom-product-pages")).json.results[0].status, "ok");
  assert.deepEqual(fake.unhandled, []);
});

test("an approved page gets a new version only when the config differs", async () => {
  const { fake, run, write } = project();
  await run("release");
  await run("submit", "--submit");
  assert.equal(fake.all("appCustomProductPageVersions")[0].attributes.state, "WAITING_FOR_REVIEW", "sent with the app");
  approveCustomPages(fake);

  const before = fake.mutations().length;
  assert.equal((await run("custom-product-pages")).json.results[0].status, "ok");
  assert.equal(fake.mutations().length, before, "same config: nothing written, no new version");

  write((c) => ({
    ...c,
    customProductPages: [
      { ...ramadan, locales: { "en-US": { ...ramadan.locales["en-US"], promotionalText: "Ramadan, calmly." } } },
    ],
  }));
  const changed = await run("custom-product-pages");
  assert.match(changed.json.results[0].message, /new version/);
  const states = fake
    .all("appCustomProductPageVersions")
    .map((v) => v.attributes.state)
    .sort();
  assert.deepEqual(states, ["APPROVED", "PREPARE_FOR_SUBMISSION"], "the approved one keeps serving");
  assert.deepEqual(fake.unhandled, []);
});

test("new screenshots on an approved page also mean a new version", async () => {
  const { root, fake, run } = project();
  await run("custom-product-pages");
  for (const v of fake.all("appCustomProductPageVersions")) v.attributes.state = "APPROVED";
  writeFileSync(join(root, "cpp/ramadan/02.png"), headerOnlyPng(1320, 2868, "changed"));
  const res = await run("custom-product-pages");
  assert.match(res.json.results[0].message, /new version/);
});

test("a screenshot that fits no device size stops the page before any request", async () => {
  const { root, fake, run } = project();
  writeFileSync(join(root, "cpp/ramadan/03.png"), headerOnlyPng(1000, 1000, "bad"));
  const res = await run("custom-product-pages");
  assert.equal(res.json.results[0].status, "error");
  assert.equal(fake.mutations().length, 0);
});

test("--dry-run creates no page", async () => {
  const { fake, run } = project();
  const res = await run("custom-product-pages", "--dry-run");
  assert.notEqual(res.code, Exit.INTERNAL);
  assert.equal(fake.all("appCustomProductPages").length, 0);
});
