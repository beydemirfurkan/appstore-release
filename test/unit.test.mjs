import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs, splitFlags, UsageError } from "../src/cli/args.mjs";
import { resolveCredentials } from "../src/core/credentials.mjs";
import { resolveProjectPath, PathError } from "../src/core/paths.mjs";
import { shouldRetry, backoffMs, retryAfterMs } from "../src/asc/retry.mjs";
import { validateConfig, requirementsFor } from "../src/core/requirements.mjs";
import { finding, Severity, FixOwner } from "../src/core/findings.mjs";

// ── args ──────────────────────────────────────────────────────────────────────

test("parseArgs reads the command, values, aliases and negations", () => {
  const { command, flags } = parseArgs(["check", "--config=/tmp/a.json", "--app-id", "42", "-y", "--no-json"]);
  assert.equal(command, "check");
  assert.equal(flags.config, "/tmp/a.json");
  assert.equal(flags["app-id"], "42");
  assert.equal(flags.yes, true);
  assert.equal(flags.json, false);
});

test("parseArgs accepts a flag declared by an operation, and rejects it elsewhere", () => {
  /** @type {Record<string, import("../src/cli/args.mjs").FlagSpec>} */
  const opFlags = { build: { type: "string", description: "" } };
  assert.equal(parseArgs(["attach-build", "--build", "7"], opFlags).flags.build, "7");
  // This is the regression guard: --build was documented for a year and never parsed.
  assert.throws(() => parseArgs(["attach-build", "--build", "7"]), UsageError);
});

test("parseArgs rejects an unknown flag and a missing value", () => {
  assert.throws(() => parseArgs(["status", "--nope"]), UsageError);
  assert.throws(() => parseArgs(["status", "--config"]), UsageError);
});

test("splitFlags separates operation args from globals and camel-cases", () => {
  /** @type {Record<string, import("../src/cli/args.mjs").FlagSpec>} */
  const flagSpec = { prune: { type: "boolean", description: "" } };
  const { globals, opArgs } = parseArgsSplit(["screenshots", "--project-root", "/x", "--prune"], flagSpec);
  assert.equal(globals.projectRoot, "/x");
  assert.equal(opArgs.prune, true);
  function parseArgsSplit(argv, opFlags) {
    return splitFlags(parseArgs(argv, opFlags).flags, opFlags);
  }
});

// ── credentials ───────────────────────────────────────────────────────────────

test("resolveCredentials reports every missing value at once", () => {
  const { credentials, findings } = resolveCredentials({}, { env: {} });
  assert.equal(credentials, null);
  assert.deepEqual(findings.map((f) => f.id).sort(), [
    "account.credentials.issuerId",
    "account.credentials.keyId",
    "account.credentials.privateKey",
  ]);
});

test("resolveCredentials accepts an inline key as PEM or base64", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
  const env = { ASC_KEY_ID: "ABCDE12345", ASC_ISSUER_ID: "issuer", ASC_APP_ID: "42" };
  for (const value of [pem, Buffer.from(pem).toString("base64")]) {
    const { credentials, findings } = resolveCredentials({ privateKey: value }, { env });
    assert.ok(credentials);
    assert.equal(credentials.privateKey, pem);
    assert.deepEqual(findings, []);
  }
});

test("the private key never appears in JSON or enumeration", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
  const { credentials } = resolveCredentials(
    { keyId: "ABCDE12345", issuerId: "i", privateKey: pem, appId: "42" },
    { env: {} },
  );
  assert.ok(credentials);
  assert.ok(!JSON.stringify(credentials).includes("secret"));
  assert.ok(!Object.keys(credentials).includes("privateKey"));
  assert.equal(credentials.privateKey, pem); // still readable by the code that needs it
});

test("a bundle id in ASC_APP_ID is caught before it becomes a 404", () => {
  const env = { ASC_KEY_ID: "ABCDE12345", ASC_ISSUER_ID: "i", ASC_P8: "-----BEGIN PRIVATE KEY-----\nx\n-----END-----" };
  const { findings } = resolveCredentials({ appId: "com.example.app" }, { env });
  assert.ok(findings.some((f) => f.id === "account.credentials.appId.malformed"));
});

// ── paths ─────────────────────────────────────────────────────────────────────

test("resolveProjectPath anchors relative paths to the project root, not the cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "asr-"));
  assert.equal(resolveProjectPath(root, "./assets/shots"), join(root, "assets/shots"));
});

test("resolveProjectPath refuses to escape the project root", () => {
  const root = mkdtempSync(join(tmpdir(), "asr-"));
  assert.throws(() => resolveProjectPath(root, "../../etc/passwd"), PathError);
  assert.throws(() => resolveProjectPath(root, "/etc/passwd"), PathError);
});

test("resolveProjectPath resolves symlinks before judging containment", () => {
  const root = mkdtempSync(join(tmpdir(), "asr-"));
  const outside = mkdtempSync(join(tmpdir(), "asr-out-"));
  writeFileSync(join(outside, "secret.txt"), "x");
  symlinkSync(outside, join(root, "link"));
  assert.throws(() => resolveProjectPath(root, "link/secret.txt"), PathError);
});

test("resolveProjectPath allows a file that does not exist yet inside the root", () => {
  const root = mkdtempSync(join(tmpdir(), "asr-"));
  mkdirSync(join(root, "secrets"));
  assert.equal(resolveProjectPath(root, "secrets/dist.p12"), join(root, "secrets/dist.p12"));
});

// ── retry ─────────────────────────────────────────────────────────────────────

test("429 is retried for every method; a 500 only for repeatable ones", () => {
  const base = { attempt: 1, attempts: 4 };
  assert.equal(shouldRetry({ ...base, method: "POST", status: 429 }), true);
  assert.equal(shouldRetry({ ...base, method: "GET", status: 500 }), true);
  assert.equal(shouldRetry({ ...base, method: "PATCH", status: 503 }), true);
  // A POST that died after connecting may already have created the resource.
  assert.equal(shouldRetry({ ...base, method: "POST", status: 500 }), false);
  assert.equal(shouldRetry({ ...base, method: "POST", error: { code: "ECONNRESET" } }), false);
  // ...but one that never connected certainly did not.
  assert.equal(shouldRetry({ ...base, method: "POST", error: { code: "ECONNREFUSED" } }), true);
});

test("retries stop at the attempt limit", () => {
  assert.equal(shouldRetry({ method: "GET", status: 429, attempt: 4, attempts: 4 }), false);
});

test("backoff is bounded and jittered", () => {
  assert.equal(backoffMs(1, { baseMs: 500, capMs: 8000 }, () => 0.999) < 500, true);
  assert.equal(backoffMs(9, { baseMs: 500, capMs: 8000 }, () => 0.999) <= 8000, true);
  assert.equal(
    backoffMs(3, {}, () => 0),
    0,
  );
});

test("Apple's Retry-After wins over our own backoff", () => {
  assert.equal(retryAfterMs(new Headers({ "retry-after": "2" })), 2000);
  assert.equal(retryAfterMs(new Headers()), null);
});

// ── config requirements ───────────────────────────────────────────────────────

test("requirementsFor is the union of the concerns, plus locale", () => {
  const paths = requirementsFor(["category", "pricing"]);
  assert.deepEqual(paths, ["locale", "category.primary", "metadata.copyright"]);
});

test("validateConfig names the exact missing keys", () => {
  const { valid, findings } = validateConfig({ locale: "en-US", metadata: { name: "A" } }, { needs: ["metadata"] });
  assert.equal(valid, false);
  assert.ok(findings.some((f) => f.id === "config.metadata.description.missing"));
  assert.ok(!findings.some((f) => f.id === "config.metadata.name.missing"));
});

test("emoji in the description is a blocker, not a warning — Apple returns 409", () => {
  const { valid, findings } = validateConfig({ locale: "en-US", metadata: { description: "Great app 🎉" } });
  const emoji = findings.find((f) => f.id === "config.metadata.description.emoji");
  assert.ok(emoji);
  assert.equal(emoji.severity, Severity.BLOCKER);
  assert.equal(valid, false);
});

test("length limits are enforced against the documented maxima", () => {
  const { findings } = validateConfig({ locale: "en-US", metadata: { keywords: "x".repeat(101) } });
  assert.ok(findings.some((f) => f.id === "config.metadata.keywords.too-long"));
});

// ── findings ──────────────────────────────────────────────────────────────────

test("uiOnly can only be true when a human in App Store Connect owns the fix", () => {
  // Guards the one lie the product cannot afford: our own gaps marked as Apple's.
  assert.equal(finding({ id: "x", title: "x", uiOnly: true, fixOwner: FixOwner.CLI }).uiOnly, false);
  assert.equal(finding({ id: "x", title: "x", uiOnly: true, fixOwner: FixOwner.UI }).uiOnly, true);
});

test("a blocker blocks submission by default", () => {
  assert.equal(finding({ id: "x", title: "x" }).blocksSubmission, true);
  assert.equal(finding({ id: "x", title: "x", severity: Severity.WARNING }).blocksSubmission, false);
});
