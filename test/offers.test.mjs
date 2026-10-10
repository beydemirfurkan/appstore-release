// Promotional offers, offer codes, one-time code batches and accessibility
// labels, end to end against the fake App Store Connect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../src/cli.mjs";
import { Exit } from "../src/core/status.mjs";
import { createFakeAsc } from "./helpers/fake-asc.mjs";
import { writeWellnessProject } from "./helpers/fixture-project.mjs";
import { testPrivateKey } from "./helpers/mock-asc.mjs";

/**
 * The wellness project with its config changed by `edit`, against a fake.
 * @param {(config: any) => any} edit
 * @param {Record<string, any>} [fakeOptions]
 */
function project(edit, fakeOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "asr-offers-"));
  const config = writeWellnessProject(root);
  const path = join(root, "appstore.config.json");
  const write = (/** @type {(c: any) => any} */ f) =>
    writeFileSync(path, JSON.stringify(f(JSON.parse(readFileSync(path, "utf8")))));
  write(() => edit(config));
  const fake = createFakeAsc(fakeOptions);
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

const withOffers = (/** @type {any} */ extra) => (/** @type {any} */ config) => ({
  ...config,
  subscription: { ...config.subscription, ...extra },
});

test("promotional offers and offer codes are created once, with their prices inline", async () => {
  const { fake, run } = project(
    withOffers({
      promotionalOffers: [
        {
          offerCode: "COMEBACK",
          name: "Come back",
          type: "PAY_AS_YOU_GO",
          duration: "ONE_MONTH",
          periods: 3,
          priceAmount: 2.99,
        },
      ],
      offerCodes: [
        {
          name: "Launch",
          type: "FREE_TRIAL",
          duration: "ONE_MONTH",
          eligibility: ["NEW", "EXPIRED"],
          customCodes: [{ code: "WELLNESS", count: 500, expires: "2027-03-31" }],
        },
      ],
    }),
  );
  const first = await run("subscription");
  assert.equal(first.json.results[0].status, "changed", first.json.results[0].message);

  const [promo] = fake.all("subscriptionPromotionalOffers");
  assert.equal(promo.attributes.offerCode, "COMEBACK");
  assert.equal(promo.attributes.numberOfPeriods, 3);
  const [code] = fake.all("subscriptionOfferCodes");
  assert.equal(code.attributes.offerEligibility, "REPLACE_INTRO_OFFERS");
  assert.deepEqual(code.attributes.customerEligibilities, ["NEW", "EXPIRED"]);
  assert.equal(fake.all("subscriptionOfferCodeCustomCodes")[0].attributes.customCode, "WELLNESS");

  const posted = fake.calls.find((c) => c.method === "POST" && c.path === "/v1/subscriptionPromotionalOffers");
  assert.equal(posted?.body.included[0].relationships.subscriptionPricePoint.data.id, "spp-299", "nearest price point");

  const second = await run("subscription");
  assert.equal(second.json.results[0].status, "ok", "nothing is created twice");
  assert.deepEqual(fake.unhandled, []);
});

test("Apple does not let an offer change: a difference is reported, nothing is written", async () => {
  const offer = { offerCode: "COMEBACK", name: "Come back", type: "FREE_TRIAL", duration: "ONE_WEEK" };
  const { fake, run, write } = project(withOffers({ promotionalOffers: [offer] }));
  await run("subscription");
  write((c) => ({
    ...c,
    subscription: { ...c.subscription, promotionalOffers: [{ ...offer, duration: "TWO_WEEKS" }] },
  }));
  const before = fake.mutations().length;
  const again = await run("subscription");
  assert.equal(fake.mutations().length, before);
  const drift = again.json.findings.find((f) => f.id === "subscription.promotional-offer.changed.COMEBACK");
  assert.equal(drift?.severity, "warning");
  assert.match(drift?.detail ?? "", /duration: ONE_WEEK in App Store Connect, TWO_WEEKS in the config/);
});

test("an offer code and a custom code are deactivated, never deleted", async () => {
  const launch = {
    name: "Launch",
    type: "FREE_TRIAL",
    duration: "ONE_MONTH",
    eligibility: ["NEW"],
    customCodes: [{ code: "WELLNESS", count: 10 }],
  };
  const { fake, run, write } = project(withOffers({ offerCodes: [launch] }));
  await run("subscription");
  write((c) => ({
    ...c,
    subscription: {
      ...c.subscription,
      offerCodes: [{ ...launch, customCodes: [{ code: "wellness", count: 10, active: false }] }],
    },
  }));
  await run("subscription");
  assert.equal(fake.all("subscriptionOfferCodeCustomCodes")[0].attributes.active, false, "matched case-insensitively");
  write((c) => ({ ...c, subscription: { ...c.subscription, offerCodes: [{ ...launch, active: false }] } }));
  await run("subscription");
  assert.equal(fake.all("subscriptionOfferCodes")[0].attributes.active, false);
  assert.equal(fake.mutations().filter((c) => c.method === "DELETE").length, 0);
});

test("a paid offer without a price is refused before anything is sent", async () => {
  const { fake, run } = project(
    withOffers({
      promotionalOffers: [{ offerCode: "HALF", name: "Half", type: "PAY_UP_FRONT", duration: "SIX_MONTHS" }],
    }),
  );
  const res = await run("subscription");
  assert.ok(res.json.findings.some((f) => f.id === "subscription.offer.no-price.com.example.wellness.monthly"));
  assert.equal(fake.all("subscriptionPromotionalOffers").length, 0);
});

test("offer-codes generates a batch once, waits for Apple, then writes the CSV once", async () => {
  const { root, fake, run } = project(
    withOffers({
      offerCodes: [
        {
          name: "Launch",
          type: "FREE_TRIAL",
          duration: "ONE_MONTH",
          eligibility: ["NEW"],
          oneTimeCodes: [{ count: 3, expires: "2027-01-31", output: "./codes/launch.csv" }],
        },
      ],
    }),
    { offerCodeValuesAfter: 1 },
  );
  const early = await run("offer-codes");
  assert.equal(early.json.results[0].status, "error", "the offer code does not exist yet");
  assert.match(early.json.results[0].message, /does not exist/);

  await run("subscription");
  const first = await run("offer-codes");
  assert.equal(fake.all("subscriptionOfferCodeOneTimeUseCodes").length, 1);
  assert.ok(
    first.json.findings.some((f) => f.id === "offer-codes.not-ready.Launch"),
    "Apple is still generating",
  );
  assert.equal(existsSync(join(root, "codes/launch.csv")), false);

  const second = await run("offer-codes");
  assert.equal(fake.all("subscriptionOfferCodeOneTimeUseCodes").length, 1, "no second batch");
  assert.equal(readFileSync(join(root, "codes/launch.csv"), "utf8").trim().split("\n").length, 3);
  assert.ok(
    second.json.findings.some((f) => f.id === "offer-codes.not-ignored.Launch"),
    "redeemable codes outside .gitignore",
  );

  const third = await run("offer-codes");
  assert.equal(third.json.results[0].status, "ok");
  assert.deepEqual(fake.unhandled, []);
});

test("release does not generate one-time codes; offer-codes is asked for by name", async () => {
  const { fake, run } = project(
    withOffers({
      offerCodes: [
        {
          name: "Launch",
          type: "FREE_TRIAL",
          duration: "ONE_MONTH",
          eligibility: ["NEW"],
          oneTimeCodes: [{ count: 3, expires: "2027-01-31", output: "./codes/launch.csv" }],
        },
      ],
    }),
  );
  await run("release");
  assert.equal(fake.all("subscriptionOfferCodes").length, 1);
  assert.equal(fake.all("subscriptionOfferCodeOneTimeUseCodes").length, 0);
});

test("accessibility labels: a draft per device, published only when asked, replaced when they change", async () => {
  const { fake, run, write } = project((c) => ({
    ...c,
    accessibility: { iphone: { voiceover: true, largerText: true, darkInterface: true }, ipad: { voiceover: true } },
  }));
  const drafted = await run("accessibility");
  assert.match(drafted.json.results[0].message, /iphone drafted · ipad drafted \(drafts; set accessibility.publish/);
  const iphone = fake.all("accessibilityDeclarations").find((d) => d.attributes.deviceFamily === "IPHONE");
  assert.equal(iphone?.attributes.supportsVoiceover, true);
  assert.equal(iphone?.attributes.supportsCaptions, false, "what the config leaves out is not claimed");
  assert.equal(iphone?.attributes.state, "DRAFT");
  assert.equal((await run("accessibility")).json.results[0].status, "ok");

  write((c) => ({ ...c, accessibility: { ...c.accessibility, publish: true } }));
  await run("accessibility");
  assert.ok(fake.all("accessibilityDeclarations").every((d) => d.attributes.state === "PUBLISHED"));
  assert.equal((await run("accessibility")).json.results[0].status, "ok", "published as configured: nothing to do");

  write((c) => ({
    ...c,
    accessibility: { ...c.accessibility, iphone: { ...c.accessibility.iphone, captions: true } },
  }));
  await run("accessibility");
  const states = fake
    .all("accessibilityDeclarations")
    .filter((d) => d.attributes.deviceFamily === "IPHONE")
    .map((d) => d.attributes.state)
    .sort();
  assert.deepEqual(states, ["PUBLISHED", "REPLACED"]);
  assert.deepEqual(fake.unhandled, []);
});

test("accessibility is part of release, and skipped when the config says nothing", async () => {
  const { fake, run } = project((c) => c);
  const res = await run("release");
  assert.equal(res.code === Exit.OK || res.code === Exit.NEEDS_HUMAN || res.code === Exit.BLOCKED, true);
  assert.equal(res.json.results.find((r) => r.id === "accessibility")?.status, "skipped");
  assert.equal(fake.all("accessibilityDeclarations").length, 0);
});

const launch = (/** @type {any} */ extra = {}) =>
  withOffers({
    offerCodes: [
      {
        name: "Launch",
        type: "FREE_TRIAL",
        duration: "ONE_MONTH",
        eligibility: ["NEW"],
        oneTimeCodes: [{ count: 3, expires: "2027-01-31", output: "./codes/a.csv" }],
        ...extra,
      },
    ],
  });

test("offer-codes --dry-run writes no file, even for a batch that already exists", async () => {
  const { root, run } = project(launch(), { offerCodeValuesAfter: 1 });
  await run("subscription");
  await run("offer-codes"); // generates; not ready yet
  const planned = await run("offer-codes", "--dry-run");
  assert.match(planned.json.results[0].message, /would write \.\/codes\/a\.csv/);
  assert.equal(existsSync(join(root, "codes/a.csv")), false);
});

test("two batches with the same count and expiry are two batches", async () => {
  const { root, fake, run } = project(
    launch({
      oneTimeCodes: [
        { count: 3, expires: "2027-01-31", output: "./codes/a.csv" },
        { count: 3, expires: "2027-01-31", output: "./codes/b.csv" },
      ],
    }),
  );
  await run("subscription");
  await run("offer-codes");
  assert.equal(fake.all("subscriptionOfferCodeOneTimeUseCodes").length, 2);
  assert.ok(existsSync(join(root, "codes/a.csv")) && existsSync(join(root, "codes/b.csv")));
  await run("offer-codes");
  assert.equal(fake.all("subscriptionOfferCodeOneTimeUseCodes").length, 2, "and still two on a re-run");
});

test("a download App Store Connect forbids is an error, not 'not ready yet' forever", async () => {
  const { run } = project(launch(), { offerCodeValuesStatus: 403 });
  await run("subscription");
  const res = await run("offer-codes");
  assert.equal(res.json.results[0].status, "error");
  assert.ok(res.json.findings.some((f) => f.id === "offer-codes.download-failed.Launch"));
});

test("no new custom codes on an offer code that is turned off", async () => {
  const { fake, run } = project(
    launch({ active: false, oneTimeCodes: undefined, customCodes: [{ code: "LATE", count: 5 }] }),
  );
  await run("subscription");
  assert.equal(fake.all("subscriptionOfferCodes").length, 0, "nothing created just to be off");
  assert.equal(fake.all("subscriptionOfferCodeCustomCodes").length, 0);
});

test("a promotional offer's prices follow the config; its terms do not", async () => {
  const offer = {
    offerCode: "COMEBACK",
    name: "Come back",
    type: "PAY_UP_FRONT",
    duration: "SIX_MONTHS",
    priceAmount: 2.99,
  };
  const { fake, run, write } = project(withOffers({ promotionalOffers: [offer] }));
  await run("subscription");
  write((c) => ({ ...c, subscription: { ...c.subscription, promotionalOffers: [{ ...offer, priceAmount: 9.99 }] } }));
  const changed = await run("subscription");
  assert.match(changed.json.results[0].message, /prices|updated|COMEBACK/);
  const prices = fake.all("subscriptionPromotionalOfferPrices");
  assert.deepEqual(
    prices.map((p) => p.relationships?.subscriptionPricePoint?.data?.id),
    ["spp-999"],
  );
  assert.equal((await run("subscription")).json.results[0].status, "ok", "the same prices are not sent again");
});

test("an impossible date is a finding, not a crash", async () => {
  const { validateConfig } = await import("../src/core/requirements.mjs");
  for (const expires of ["2027-13-01", "2027-02-32", "2027-00-10", "2027-02-30"]) {
    const { valid, findings } = validateConfig({
      bundleId: "a.b",
      locale: "en-US",
      subscriptions: [
        {
          productId: "p",
          offerCodes: [
            {
              name: "L",
              type: "FREE_TRIAL",
              duration: "ONE_MONTH",
              eligibility: ["NEW"],
              oneTimeCodes: [{ count: 1, expires, output: "a.csv" }],
            },
          ],
        },
      ],
    });
    assert.equal(valid, false, expires);
    assert.ok(
      findings.some((f) => /not a valid date/.test(f.title)),
      expires,
    );
  }
});
