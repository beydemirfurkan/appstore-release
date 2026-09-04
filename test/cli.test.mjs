import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { main } from "../src/cli.mjs";
import { Exit } from "../src/core/status.mjs";

const run = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "../src/cli.mjs");

/** Capture both streams separately — the point of most of these assertions. */
function capture() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    get outText() {
      return out.join("");
    },
    get errText() {
      return err.join("");
    },
  };
}

const noCredentials = { env: {}, cwd: "/nonexistent-so-no-config-is-found" };

test("--version prints just the version", async () => {
  const io = capture();
  assert.equal(await main(["--version"], { ...io, ...noCredentials }), Exit.OK);
  assert.match(io.outText.trim(), /^\d+\.\d+\.\d+$/);
});

test("--help goes to stdout and exits 0; an unknown command goes to stderr and exits 2", async () => {
  const help = capture();
  assert.equal(await main(["--help"], { ...help, ...noCredentials }), Exit.OK);
  assert.match(help.outText, /Usage: appstore-release/);
  assert.equal(help.errText, "");

  const bad = capture();
  assert.equal(await main(["nope"], { ...bad, ...noCredentials }), Exit.USAGE);
  assert.match(bad.errText, /Unknown command: nope/);
  assert.equal(bad.outText, "");
});

test("an unknown flag is a usage error, not a crash", async () => {
  const io = capture();
  assert.equal(await main(["status", "--nope"], { ...io, ...noCredentials }), Exit.USAGE);
  assert.match(io.errText, /Unknown flag: --nope/);
});

test("missing credentials exit 3 and name every missing variable at once", async () => {
  const io = capture();
  assert.equal(await main(["status"], { ...io, ...noCredentials }), Exit.CONFIG);
  for (const v of ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_P8_PATH"]) {
    assert.match(io.errText, new RegExp(v));
  }
});

test("--json puts exactly one JSON document on stdout and nothing else", async () => {
  // This is the regression guard for the old behaviour, where human text and a
  // JSON blob were interleaved on the same stream and `| jq` could not work.
  const io = capture();
  await main(["status", "--json"], { ...io, ...noCredentials });

  const parsed = JSON.parse(io.outText);
  assert.equal(parsed.ok, false);
  assert.ok(Array.isArray(parsed.findings));
  assert.equal(io.outText.trimEnd().split("\n}").length, 2, "stdout held more than one document");
  assert.match(io.errText, /ASC_KEY_ID/, "human output belongs on stderr");
});

test("--exit-zero suppresses the failure code but not the diagnosis", async () => {
  const io = capture();
  assert.equal(await main(["status", "--json", "--exit-zero"], { ...io, ...noCredentials }), Exit.OK);
  assert.equal(JSON.parse(io.outText).ok, false);
});

test("the real binary exits with the code main() returned", async () => {
  await assert.rejects(
    () => run(process.execPath, [CLI, "status"], { env: { PATH: process.env.PATH }, cwd: "/" }),
    (/** @type {any} */ e) => e.code === Exit.CONFIG,
  );
  const { stdout } = await run(process.execPath, [CLI, "--version"], { env: { PATH: process.env.PATH } });
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});
