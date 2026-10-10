// TestFlight feedback, sales reports, analytics reports and product page tests,
// end to end against the fake App Store Connect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../src/cli.mjs";
import { Exit } from "../src/core/status.mjs";
import { approveExperiments, createFakeAsc } from "./helpers/fake-asc.mjs";
import { headerOnlyPng, writeWellnessProject } from "./helpers/fixture-project.mjs";
import { testPrivateKey } from "./helpers/mock-asc.mjs";
import { parseTsv, summarize } from "../src/ops/sales.mjs";

/** @param {(c: any) => any} [edit] */
function project(edit = (c) => c) {
  const root = mkdtempSync(join(tmpdir(), "asr-insights-"));
  writeWellnessProject(root);
  const path = join(root, "appstore.config.json");
  const write = (/** @type {(c: any) => any} */ f) =>
    writeFileSync(path, JSON.stringify(f(JSON.parse(readFileSync(path, "utf8")))));
  write(edit);
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

test("feedback: screenshots and crashes, newest first; a crash log on request; nothing written", async () => {
  const { fake, run } = project();
  const res = await run("feedback");
  const items = res.json.results[0].details.items;
  assert.deepEqual(
    items.map((/** @type {any} */ i) => i.id),
    ["fb-1", "crash-1", "fb-2"],
  );
  assert.equal(items[0].build, "7");
  assert.deepEqual(items[0].screenshots, ["https://example.com/s1.png"]);
  assert.match(res.json.results[0].message, /3 feedback items · 1 crash/);

  const crashes = await run("feedback", "--crashes");
  assert.deepEqual(
    crashes.json.results[0].details.items.map((/** @type {any} */ i) => i.id),
    ["crash-1"],
  );

  const log = await run("feedback", "--log", "crash-1");
  assert.match(log.json.results[0].details.logText, /EXC_CRASH/);
  assert.deepEqual(fake.mutations(), []);
});

test("sales: downloaded gzipped, summarised, saved on request; no sales is not an error", async () => {
  const { root, run } = project((c) => ({ ...c, reports: { vendorNumber: "85012345" } }));
  const res = await run("sales", "--out", "./reports/sales.tsv");
  assert.equal(res.json.results[0].status, "ok", res.json.results[0].message);
  assert.match(res.json.results[0].message, /17 units · proceeds 10\.47 USD, 120\.00 TRY/);
  assert.match(readFileSync(join(root, "reports/sales.tsv"), "utf8"), /^Provider\tSKU/);

  const none = await run("sales", "--date", "2026-01-01");
  assert.equal(none.json.results[0].status, "ok");
  assert.match(none.json.results[0].message, /no sales for the date/);

  const wrong = await run("sales", "--type", "SUBSCRIPTION", "--frequency", "MONTHLY", "--date", "2026-09");
  assert.equal(wrong.json.results[0].status, "error", "a combination Apple does not offer is refused before a request");
  const badDate = await run("sales", "--frequency", "MONTHLY", "--date", "2026-09-01");
  assert.match(badDate.json.results[0].message, /2026-09/);
});

test("sales without a vendor number says where to find it", async () => {
  const { run } = project();
  const res = await run("sales", "--vendor", "");
  assert.match(res.json.results[0].message, /Payments and Financial Reports/);
});

test("the sales summary reads Apple's columns, and only those", () => {
  const table = parseTsv("Title\tUnits\tDeveloper Proceeds\tCurrency of Proceeds\nA\t2\t1.5\tEUR\nB\t1\t0\tEUR\n");
  assert.equal(summarize(table).headline, "3 units · proceeds 3.00 EUR");
  assert.equal(summarize(parseTsv("Date\tImpressions\n2026-10-09\t5\n")).headline, "");
});

test("analytics: asks once, then lists and downloads — without sending the token to the file URL", async () => {
  const { root, fake, run } = project();
  const none = await run("analytics");
  assert.match(none.json.results[0].message, /analytics --request/);
  const asked = await run("analytics", "--request");
  assert.equal(asked.json.results[0].status, "changed");
  assert.equal((await run("analytics", "--request")).json.results[0].status, "ok", "not requested twice");

  const listed = await run("analytics");
  assert.match(listed.json.results[0].message, /1 report available/);
  const got = await run("analytics", "--report", "App Store Discovery and Engagement Detailed", "--out", "./a");
  assert.equal(got.json.results[0].status, "ok", got.json.results[0].message);
  const files = readdirSync(join(root, "a"));
  assert.deepEqual(files, ["App-Store-Discovery-and-Engagement-Detailed-daily-2026-10-09.txt"], "the latest day");
  assert.match(readFileSync(join(root, "a", files[0]), "utf8"), /2026-10-09\t120/);
  const download = fake.calls.find((c) => c.path.startsWith("/__segments/"));
  assert.equal(download?.authorized, false);
});

test("product page tests: prepared from the config, sent with the app, started only when asked", async () => {
  const { root, fake, run, write } = project((c) => ({
    ...c,
    experiments: [
      {
        name: "Calmer screens",
        trafficProportion: 50,
        treatments: [{ name: "Calm", locales: { "en-US": { screenshots: "./ppo/calm" } } }],
      },
    ],
  }));
  mkdirSync(join(root, "ppo/calm"), { recursive: true });
  writeFileSync(join(root, "ppo/calm/01.png"), headerOnlyPng(1320, 2868, "calm1"));

  const first = await run("experiments");
  assert.equal(first.json.results[0].status, "changed", first.json.results[0].message);
  const [exp] = fake.all("appStoreVersionExperiments");
  assert.equal(exp.attributes.platform, "IOS");
  assert.equal(exp.attributes.trafficProportion, 50);
  assert.equal(fake.all("appStoreVersionExperimentTreatments").length, 1);
  const placed = fake
    .all("appAssetLibraryPlacements")
    .filter((p) => p.relationships?.appStoreVersionExperimentTreatmentLocalization);
  assert.equal(placed.length, 1);
  assert.equal((await run("experiments")).json.results[0].status, "ok");

  await run("release");
  const sent = await run("submit", "--submit");
  assert.equal(sent.code, Exit.OK, JSON.stringify(sent.json.results, null, 2));
  assert.equal(exp.attributes.state, "WAITING_FOR_REVIEW");
  assert.match((await run("experiments")).json.results[0].message, /in review/);

  approveExperiments(fake);
  const approved = await run("experiments");
  assert.match(approved.json.results[0].message, /set start: true to start it/);
  assert.equal(exp.attributes.startDate, undefined, "never started by accident");
  write((c) => ({ ...c, experiments: [{ ...c.experiments[0], start: true }] }));
  await run("experiments");
  assert.ok(exp.attributes.startDate);
  assert.deepEqual(fake.unhandled, []);
});

test("a treatment removed from the config is removed while the test is prepared", async () => {
  const { root, fake, run, write } = project((c) => ({
    ...c,
    experiments: [
      {
        name: "Two ways",
        trafficProportion: 30,
        treatments: [
          { name: "A", locales: { "en-US": { screenshots: "./ppo/a" } } },
          { name: "B", locales: { "en-US": { screenshots: "./ppo/a" } } },
        ],
      },
    ],
  }));
  mkdirSync(join(root, "ppo/a"), { recursive: true });
  writeFileSync(join(root, "ppo/a/01.png"), headerOnlyPng(1320, 2868, "a"));
  await run("experiments");
  assert.equal(fake.all("appStoreVersionExperimentTreatments").length, 2);
  write((c) => ({
    ...c,
    experiments: [{ ...c.experiments[0], trafficProportion: 40, treatments: [c.experiments[0].treatments[0]] }],
  }));
  const res = await run("experiments");
  assert.match(res.json.results[0].message, /traffic 40%/);
  assert.deepEqual(
    fake.all("appStoreVersionExperimentTreatments").map((t) => t.attributes.name),
    ["A"],
  );
});
