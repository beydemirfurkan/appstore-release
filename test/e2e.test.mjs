// The whole product, driven the way a person or an agent drives it: the real CLI
// entrypoint against a fake App Store Connect that changes as it is written to.
//
// Every earlier test exercised an operation or a check in isolation, and all of
// them passed while `submit --submit` could not be typed and the verdict could
// never reach "ready". This one follows the README from top to bottom.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../src/cli.mjs";
import { Exit } from "../src/core/status.mjs";
import { createFakeAsc } from "./helpers/fake-asc.mjs";
import { writeWellnessProject } from "./helpers/fixture-project.mjs";
import { testPrivateKey } from "./helpers/mock-asc.mjs";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "asr-e2e-"));
  writeWellnessProject(root);
  const fake = createFakeAsc();
  const env = {
    ASC_KEY_ID: "ABCDE12345",
    ASC_ISSUER_ID: "69a6de00-0000-0000-0000-000000000000",
    ASC_P8: testPrivateKey(),
    ASC_APP_ID: "1234567890",
  };
  /** Run one command; returns its exit code and the parsed --json document. */
  const cli = async (/** @type {string[]} */ ...argv) => {
    const out = [];
    const io = {
      stdout: { write: (s) => out.push(s) },
      stderr: { write: () => {} },
      env,
      cwd: root,
      fetchImpl: fake.fetchImpl,
    };
    const code = await main([...argv, "--json"], io);
    return { code, json: JSON.parse(out.join("")) };
  };
  return { root, fake, cli };
}

const verdictOf = (json) => json.results.find((r) => r.id === "check")?.details?.verdict;

test("check → release → check → submit reaches App Review, and a second release sends nothing", async () => {
  const { fake, cli } = setup();

  const before = await cli("check");
  assert.equal(before.code, Exit.BLOCKED, "a half-prepared app is blocked on work this tool can do");
  assert.equal(verdictOf(before.json), "blocked");

  const dry = await cli("release", "--dry-run");
  assert.ok(dry.json.changes.length > 0, "the dry run shows the diff");
  assert.deepEqual(fake.mutations(), [], "and sends none of it");

  const release = await cli("release");
  const failed = release.json.results.filter((r) => r.status === "error");
  assert.deepEqual(
    failed.map((r) => `${r.id}: ${r.message}`),
    [],
  );
  assert.equal(
    verdictOf(release.json),
    "ready",
    JSON.stringify(
      release.json.findings.filter((f) => f.severity === "blocker"),
      null,
      2,
    ),
  );
  assert.equal(release.code, Exit.OK);

  // Idempotency across the whole pipeline, not one operation at a time.
  const writes = fake.mutations().length;
  const again = await cli("release");
  assert.deepEqual(
    again.json.results.filter((r) => r.status === "changed").map((r) => r.id),
    [],
    "a second release with nothing changed must change nothing",
  );
  assert.equal(fake.mutations().length, writes, "and must send no writes");

  // The Duo set went through the App Asset Library, which is the only place it exists.
  const duo = fake
    .all("appAssetLibraryPlacements")
    .filter((p) => p.attributes.placementGroup === "IPHONE_DUO_OUTER_PROFILE");
  assert.equal(duo.length, 3);

  const submit = await cli("submit", "--submit");
  assert.equal(submit.code, Exit.OK, JSON.stringify(submit.json.results, null, 2));
  assert.equal(fake.get("appStoreVersions", "ver-1")?.attributes.appStoreState, "WAITING_FOR_REVIEW");
  // The app already sells an approved plan, so this one goes in the same
  // submission, by API (API 4.4.1 versioned subscriptions).
  const items = fake.all("reviewSubmissionItems");
  assert.ok(
    items.some((i) => i.relationships?.subscriptionVersion),
    "subscription version submitted",
  );
  assert.equal(fake.get("subscriptions", "sub-1")?.attributes.state, "WAITING_FOR_REVIEW");

  const after = await cli("check");
  assert.equal(verdictOf(after.json), "in-review");

  const resubmit = await cli("submit", "--submit");
  assert.equal(resubmit.json.results[0].status, "ok", "submitting again is a no-op, not a second submission");
  assert.equal(fake.all("reviewSubmissions").length, 1);

  assert.deepEqual(fake.unhandled, [], "every request was one the fake models");
});

test("without the App Privacy attestation, release stops at needs-human with the exact clicks", async () => {
  const { root, cli } = setup();
  const { readFileSync, writeFileSync } = await import("node:fs");
  const path = join(root, "appstore.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  delete config.review.privacyPublished;
  writeFileSync(path, JSON.stringify(config));

  const release = await cli("release");
  assert.equal(verdictOf(release.json), "needs-human");
  assert.equal(release.code, Exit.NEEDS_HUMAN, "exit 5: only a person in App Store Connect can finish");

  const submit = await cli("submit", "--submit");
  assert.equal(submit.code, Exit.BLOCKED);
  assert.match(submit.json.results[0].message, /not ready to submit \(needs-human\)/);
});

test("check --wait follows the review to its outcome, and exits 8 when time runs out", async () => {
  const { fake, cli } = setup();
  await cli("release");
  await cli("submit", "--submit");
  const version = fake.get("appStoreVersions", "ver-1");

  const pending = await cli("check", "--wait", "0.003", "--poll-seconds", "0.02");
  assert.equal(pending.code, Exit.WAITING, "still in review when the wait ends");
  assert.equal(pending.json.results[0].details.timedOut, true);

  // Apple approves while we are watching.
  setTimeout(() => {
    if (version) version.attributes.appStoreState = "PENDING_DEVELOPER_RELEASE";
  }, 60);
  const approved = await cli("check", "--wait", "1", "--poll-seconds", "0.02");
  assert.equal(approved.code, Exit.OK);
  assert.equal(verdictOf(approved.json), "approved");
});

test("screenshots.from takes any export folder and sorts it into device sets by pixel size", async () => {
  const { root, fake, cli } = setup();
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { headerOnlyPng } = await import("./helpers/fixture-project.mjs");
  // The shape a screenshot generator might export: nested, mixed devices, odd names.
  const out = join(root, "exports", "run-42");
  mkdirSync(join(out, "phone"), { recursive: true });
  mkdirSync(join(out, "foldable"), { recursive: true });
  for (const n of [1, 2]) writeFileSync(join(out, "phone", `screen-${n}.png`), headerOnlyPng(1320, 2868, `p${n}`));
  for (const n of [1, 2]) writeFileSync(join(out, "foldable", `screen-${n}.png`), headerOnlyPng(1398, 2034, `d${n}`));

  const path = join(root, "appstore.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.screenshots = { from: "./exports" };
  writeFileSync(path, JSON.stringify(config));

  const release = await cli("release");
  assert.equal(
    verdictOf(release.json),
    "ready",
    JSON.stringify(
      release.json.findings.filter((f) => f.severity === "blocker"),
      null,
      2,
    ),
  );
  const groups = fake
    .all("appAssetLibraryPlacements")
    .map((p) => p.attributes.placementGroup)
    .sort();
  assert.deepEqual(groups, [
    "IPHONE_DUO_OUTER_PROFILE",
    "IPHONE_DUO_OUTER_PROFILE",
    "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE",
    "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE",
  ]);
  const uploaded = fake.all("appAssetLibraryImages").map((i) => i.attributes.fileName);
  assert.ok(
    uploaded.every((n) => !n.includes("/")),
    "uploads are named by file, not by path",
  );

  const writes = fake.mutations().length;
  await cli("release");
  assert.equal(fake.mutations().length, writes, "and a second run sends nothing");
});

test("an app's first subscription stops at needs-human with the clicks, as Apple requires", async () => {
  const root = mkdtempSync(join(tmpdir(), "asr-e2e-first-"));
  writeWellnessProject(root);
  const fake = createFakeAsc({ firstSubscription: true });
  const env = {
    ASC_KEY_ID: "ABCDE12345",
    ASC_ISSUER_ID: "69a6de00-0000-0000-0000-000000000000",
    ASC_P8: testPrivateKey(),
    ASC_APP_ID: "1234567890",
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

  const release = await run("release");
  assert.equal(verdictOf(release.json), "needs-human");
  assert.equal(release.code, Exit.NEEDS_HUMAN);
  const first = release.json.findings.find((f) => f.id === "subscription.first.ui-only");
  assert.ok(first?.fixClicks?.includes("Add for Review"));

  // Forced through, the version goes alone: the first subscription is never added by API.
  await run("submit", "--submit", "--force");
  assert.equal(
    fake.all("reviewSubmissionItems").some((i) => i.relationships?.subscriptionVersion),
    false,
  );
});

test("an Expo project's store.config.json, eas.json and app.json are used as they are", async () => {
  const { writeFileSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "asr-e2e-expo-"));
  const ours = writeWellnessProject(root);
  // EAS Metadata carries the listing; appstore.config.json only what EAS cannot say.
  const store = {
    configVersion: 0,
    apple: {
      copyright: "2026 Example Inc.",
      info: {
        "en-US": {
          title: "Wellness",
          subtitle: "Small habits, every day",
          description: ours.metadata.description,
          keywords: ["health", "routine", "tracker", "mood"],
          supportUrl: "https://example.com/support",
          marketingUrl: "https://example.com",
          privacyPolicyUrl: "https://example.com/privacy",
        },
      },
      advisory: { healthOrWellnessTopics: true, alcoholTobaccoOrDrugUseOrReferences: "NONE" },
      categories: ["HEALTH_AND_FITNESS"],
      release: { automaticRelease: true },
      review: { firstName: "Ada", lastName: "Lovelace", email: "review@example.com", phone: "+1 555 0100" },
    },
  };
  writeFileSync(join(root, "store.config.json"), JSON.stringify(store));
  writeFileSync(
    join(root, "app.json"),
    JSON.stringify({ expo: { version: "1.0", ios: { bundleIdentifier: "com.example.wellness" } } }),
  );
  writeFileSync(
    join(root, "eas.json"),
    JSON.stringify({ submit: { production: { ios: { ascAppId: "1234567890" } } } }),
  );
  const { metadata, ageRating, category, review, release, bundleId, locale, ...rest } = ours;
  writeFileSync(
    join(root, "appstore.config.json"),
    JSON.stringify({ ...rest, easMetadata: "./store.config.json", review: { privacyPublished: true } }),
  );

  const fake = createFakeAsc();
  const env = {
    ASC_KEY_ID: "ABCDE12345",
    ASC_ISSUER_ID: "69a6de00-0000-0000-0000-000000000000",
    ASC_P8: testPrivateKey(),
    // no ASC_APP_ID: it comes from eas.json
  };
  const out = [];
  const io = {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: () => {} },
    env,
    cwd: root,
    fetchImpl: fake.fetchImpl,
  };
  const code = await main(["release", "--json"], io);
  const json = JSON.parse(out.join(""));
  assert.equal(
    verdictOf(json),
    "ready",
    JSON.stringify(
      json.findings.filter((f) => f.severity === "blocker"),
      null,
      2,
    ),
  );
  assert.equal(code, Exit.OK);
  assert.equal(
    fake.get("appStoreVersionLocalizations", "verloc-1")?.attributes.keywords,
    "health,routine,tracker,mood",
  );
  assert.equal(fake.get("ageRatingDeclarations", "age-1")?.attributes.healthOrWellnessTopics, true);
});

/** The Wellness project with extra products, against a fake with the given options. */
async function productsProject(fakeOptions, extra) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "asr-e2e-products-"));
  writeWellnessProject(root);
  const path = join(root, "appstore.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify(extra(config)));
  const fake = createFakeAsc(fakeOptions);
  const env = {
    ASC_KEY_ID: "ABCDE12345",
    ASC_ISSUER_ID: "69a6de00-0000-0000-0000-000000000000",
    ASC_P8: testPrivateKey(),
    ASC_APP_ID: "1234567890",
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
  return { fake, run };
}

test("several plans, a free trial and a lifetime purchase: created, completed, submitted together", async () => {
  const { fake, run } = await productsProject({ approvedPurchase: true }, (config) => {
    const monthly = { ...config.subscription, introOffer: { type: "FREE_TRIAL", duration: "ONE_WEEK" } };
    const yearly = {
      productId: "com.example.wellness.pro.yearly",
      name: "Pro Yearly",
      period: "ONE_YEAR",
      localeName: "Pro Yearly",
      priceAmount: 9.99,
      reviewScreenshot: "./assets/paywall-1320x2868.png",
    };
    const lifetime = {
      productId: "com.example.wellness.lifetime",
      name: "Lifetime",
      localeName: "Lifetime access",
      localeDescription: "Every feature, forever.",
      priceAmount: 49.99,
      reviewScreenshot: "./assets/paywall-1320x2868.png",
    };
    const { subscription, ...rest } = config;
    return { ...rest, subscriptions: [monthly, yearly], inAppPurchases: [lifetime] };
  });

  const release = await run("release");
  assert.equal(
    verdictOf(release.json),
    "ready",
    JSON.stringify(
      release.json.findings.filter((f) => f.severity === "blocker"),
      null,
      2,
    ),
  );
  const yearly = fake.all("subscriptions").find((s) => s.attributes.productId === "com.example.wellness.pro.yearly");
  assert.equal(yearly?.attributes.subscriptionPeriod, "ONE_YEAR", "the missing plan was created");
  assert.deepEqual(
    fake
      .all("subscriptionIntroductoryOffers")
      .map((o) => [o.attributes.offerMode, o.attributes.duration, o.relationships?.territory]),
    [["FREE_TRIAL", "ONE_WEEK", undefined]],
    "a free trial carries no price and no territory",
  );
  const lifetime = fake.all("inAppPurchases").find((p) => p.attributes.productId === "com.example.wellness.lifetime");
  assert.equal(lifetime?.attributes.inAppPurchaseType, "NON_CONSUMABLE");
  assert.equal(lifetime?.attributes.state, "READY_TO_SUBMIT");

  const writes = fake.mutations().length;
  await run("release");
  assert.equal(fake.mutations().length, writes, "a second release sends nothing, products included");

  const submit = await run("submit", "--submit");
  assert.equal(submit.code, Exit.OK, JSON.stringify(submit.json.results, null, 2));
  const items = fake.all("reviewSubmissionItems");
  assert.equal(items.filter((i) => i.relationships?.subscriptionVersion).length, 2, "both plans");
  assert.equal(items.filter((i) => i.relationships?.inAppPurchaseVersion).length, 1, "and the lifetime purchase");
});

test("an app's first in-app purchase stops at needs-human, like its first subscription", async () => {
  const { run } = await productsProject({}, (config) => ({
    ...config,
    inAppPurchases: [
      {
        productId: "com.example.wellness.lifetime",
        name: "Lifetime",
        localeName: "Lifetime access",
        priceAmount: 49.99,
        reviewScreenshot: "./assets/paywall-1320x2868.png",
      },
    ],
  }));
  const release = await run("release");
  assert.equal(verdictOf(release.json), "needs-human");
  assert.ok(release.json.findings.some((f) => f.id === "iap.first.ui-only" && f.uiOnly));
});

test("rejected → fixed → resubmitted: the same submission goes back, its items marked resolved", async () => {
  const { fake, cli } = setup();
  const { rejectSubmission } = await import("./helpers/fake-asc.mjs");
  await cli("release");
  await cli("submit", "--submit");
  rejectSubmission(fake);

  const rejected = await cli("check");
  assert.equal(verdictOf(rejected.json), "rejected");
  assert.equal(rejected.code, Exit.NEEDS_HUMAN, "the reviewer's message is only in App Store Connect");

  const refused = await cli("submit", "--submit");
  assert.match(refused.json.results[0].message, /read Resolution Center, fix it, then submit --submit --resolved/);

  const again = await cli("submit", "--submit", "--resolved");
  assert.equal(again.code, Exit.OK, JSON.stringify(again.json.results, null, 2));
  assert.equal(fake.all("reviewSubmissions").length, 1, "no second submission");
  assert.ok(fake.all("reviewSubmissionItems").every((i) => i.attributes.resolved === true));
  assert.equal(fake.get("appStoreVersions", "ver-1")?.attributes.appStoreState, "WAITING_FOR_REVIEW");
  assert.deepEqual(fake.unhandled, []);
});
