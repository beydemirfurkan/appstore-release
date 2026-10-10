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
  // API 4.4.1: the first subscription goes in the same submission, by API.
  const items = fake.all("reviewSubmissionItems");
  assert.ok(
    items.some((i) => i.relationships?.subscriptionVersion),
    "subscription version submitted",
  );
  assert.ok(
    items.some((i) => i.relationships?.subscriptionGroupVersion),
    "its group travels with it",
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
