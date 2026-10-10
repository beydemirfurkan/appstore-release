// The skills ship on their own — to skills.sh, Codex, Cursor — so these tests
// hold them to the Agent Skills spec and pin how the launcher finds the CLI.
// Nothing here touches the network: the clone path is exercised by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { checkSkills, parseFrontmatter, relativeLinks } from "../scripts/check-skills.mjs";
import { isCheckout, resolveLocal, VERSION } from "../scripts/skill-launcher.mjs";
import { RESOURCES } from "../src/mcp/resources.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const scratch = () => mkdtempSync(join(tmpdir(), "asc-skills-"));
// Directories only: Finder leaves .DS_Store files next to them.
const skillNames = () =>
  readdirSync(join(ROOT, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

// ── the shipped skills ────────────────────────────────────────────────────────

test("every shipped skill passes the skill gate", () => {
  const { skills, errors } = checkSkills(ROOT);
  assert.deepEqual(errors, []);
  assert.deepEqual(skills.sort(), [
    "appstore-release",
    "asc-age-rating",
    "asc-credentials",
    "asc-rejection",
    "asc-reviews",
    "asc-screenshots",
    "asc-subscriptions",
    "asc-testflight",
  ]);
});

test("every skill is stamped with the package version and carries the launcher at that version", () => {
  assert.equal(VERSION, pkg.version);
  for (const name of skillNames()) {
    const fm = parseFrontmatter(readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8"));
    assert.ok(fm);
    assert.equal(fm.data.metadata.version, pkg.version, name);
    assert.equal(fm.data.license, "MIT", name);
    assert.match(fm.data.description, /Use when/, `${name}: the description must say when to trigger`);
  }
});

test("skills.sh.json groups exactly the skills that exist", () => {
  const { groupings } = JSON.parse(readFileSync(join(ROOT, "skills.sh.json"), "utf8"));
  const grouped = groupings.flatMap((g) => g.skills).sort();
  assert.deepEqual(grouped, skillNames());
});

test("the router names every focused skill, so an agent can hand off", () => {
  const router = readFileSync(join(ROOT, "skills/appstore-release/SKILL.md"), "utf8");
  for (const name of skillNames().filter((n) => n !== "appstore-release")) {
    assert.match(router, new RegExp(`\\*\\*${name}\\*\\*`), name);
  }
});

// ── the gate itself ───────────────────────────────────────────────────────────

/** A throwaway repo with one skill, for exercising the gate's failure modes. */
function fakeRepo(skillName, skillMd, extra = {}) {
  const root = scratch();
  const launcher = "// launcher\n";
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/skill-launcher.mjs"), launcher);
  const dir = join(root, "skills", skillName);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMd);
  writeFileSync(join(dir, "scripts/asc.mjs"), extra.launcher ?? launcher);
  return root;
}

const md = (fm, body = "# Body\n") => `---\n${fm}\n---\n\n${body}`;

test("the gate rejects a name that does not match its directory", () => {
  const root = fakeRepo("asc-foo", md("name: asc-bar\ndescription: Does a thing. Use when asked."));
  assert.match(checkSkills(root).errors.join("\n"), /must equal the directory name/);
});

test("the gate rejects invalid names and over-long descriptions", () => {
  const root = fakeRepo("Bad--Name", md(`name: Bad--Name\ndescription: ${"x".repeat(1025)}`));
  const errors = checkSkills(root).errors.join("\n");
  assert.match(errors, /a-z, 0-9 and single hyphens/);
  assert.match(errors, /description must be 1-1024/);
});

test("the gate rejects an unquoted ': ' that a real YAML parser would choke on", () => {
  const root = fakeRepo("asc-foo", md("name: asc-foo\ndescription: Note: this breaks YAML"));
  assert.match(checkSkills(root).errors.join("\n"), /quote the value/);
});

test("the gate rejects links that leave the skill or do not resolve", () => {
  const body = "[sibling](../other/SKILL.md) [missing](references/nope.md) [web](https://x.dev) [anchor](#a)\n";
  const root = fakeRepo("asc-foo", md("name: asc-foo\ndescription: Does a thing. Use when asked.", body));
  const errors = checkSkills(root).errors.join("\n");
  assert.match(errors, /leaves the skill directory/);
  assert.match(errors, /does not resolve/);
  assert.doesNotMatch(errors, /x\.dev|#a/);
});

test("the gate rejects a launcher copy that drifted", () => {
  const root = fakeRepo("asc-foo", md("name: asc-foo\ndescription: Does a thing. Use when asked."), {
    launcher: "// edited by hand\n",
  });
  assert.match(checkSkills(root).errors.join("\n"), /differs from scripts\/skill-launcher\.mjs/);
});

test("frontmatter parsing handles quoting and the metadata map", () => {
  const fm = parseFrontmatter(md(`name: x\ndescription: "a: b"\nmetadata:\n  author: Me\n  version: "1.0"`));
  assert.ok(fm);
  assert.deepEqual(fm.errors, []);
  assert.equal(fm.data.description, "a: b");
  assert.deepEqual(fm.data.metadata, { author: "Me", version: "1.0" });
  assert.equal(parseFrontmatter("# no frontmatter"), null);
});

test("links inside code fences are not links", () => {
  assert.deepEqual(relativeLinks("```\n[x](nope.md)\n```\n[y](yes.md#h)"), ["yes.md"]);
});

// ── the launcher ──────────────────────────────────────────────────────────────

test("the launcher recognises this repository as a checkout", () => {
  assert.equal(isCheckout(ROOT), true);
  assert.equal(isCheckout(scratch()), false);
});

test("APPSTORE_RELEASE_HOME wins, and a wrong one is an error rather than a silent fallback", () => {
  const found = resolveLocal({ env: { APPSTORE_RELEASE_HOME: ROOT }, from: scratch() });
  assert.deepEqual(found, { root: ROOT, source: "APPSTORE_RELEASE_HOME" });
  assert.throws(
    () => resolveLocal({ env: { APPSTORE_RELEASE_HOME: scratch() }, from: ROOT }),
    /not an appstore-release checkout/,
  );
});

test("CLAUDE_PLUGIN_ROOT is used when it is this package, ignored when it is another plugin", () => {
  assert.equal(resolveLocal({ env: { CLAUDE_PLUGIN_ROOT: ROOT }, from: scratch() })?.source, "CLAUDE_PLUGIN_ROOT");
  const other = scratch();
  const cache = scratch();
  assert.equal(resolveLocal({ env: { CLAUDE_PLUGIN_ROOT: other, XDG_CACHE_HOME: cache }, from: other }), null);
});

test("inside a checkout, the launcher walks up to it", () => {
  const found = resolveLocal({
    env: { XDG_CACHE_HOME: scratch() },
    from: join(ROOT, "skills/asc-screenshots/scripts"),
  });
  assert.deepEqual(found, { root: ROOT, source: "enclosing checkout" });
});

test("outside a checkout, a pinned cache entry is used and nothing is cloned", () => {
  const cache = scratch();
  const pinned = join(cache, "appstore-release", `v${VERSION}`);
  mkdirSync(join(pinned, "src"), { recursive: true });
  writeFileSync(join(pinned, "src/cli.mjs"), "");
  writeFileSync(join(pinned, "package.json"), JSON.stringify({ name: "appstore-release" }));
  const found = resolveLocal({ env: { XDG_CACHE_HOME: cache }, from: scratch() });
  assert.deepEqual(found, { root: pinned, source: `cache (v${VERSION})` });
});

test("an installed copy of a skill runs the CLI through its launcher", () => {
  // What `npx skills add` produces: the skill directory alone, somewhere else.
  const installed = join(scratch(), "asc-screenshots");
  cpSync(join(ROOT, "skills/asc-screenshots"), installed, { recursive: true });
  try {
    /** @type {Record<string, string | undefined>} */
    const env = { ...process.env, APPSTORE_RELEASE_HOME: ROOT };
    delete env.CLAUDE_PLUGIN_ROOT;
    const which = spawnSync(process.execPath, [join(installed, "scripts/asc.mjs"), "--which-cli"], {
      env,
      encoding: "utf8",
    });
    assert.equal(which.status, 0, which.stderr);
    assert.equal(which.stdout.trim(), `${join(ROOT, "src/cli.mjs")}\tAPPSTORE_RELEASE_HOME`);

    const version = spawnSync(process.execPath, [join(installed, "scripts/asc.mjs"), "--version"], {
      env,
      encoding: "utf8",
    });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), pkg.version);
  } finally {
    rmSync(dirname(installed), { recursive: true, force: true });
  }
});

// ── MCP resources ─────────────────────────────────────────────────────────────

test("every skill and every reference is an MCP resource, and the v2 URIs still resolve", () => {
  const uris = new Set(RESOURCES.map((r) => r.uri));
  assert.equal(uris.size, RESOURCES.length, "URIs are unique");
  for (const name of skillNames()) assert.ok(uris.has(`appstore-release://skills/${name}`), name);
  assert.ok(uris.has("appstore-release://skills/asc-screenshots/references/sizes.md"));
  for (const legacy of [
    "gotchas",
    "runbook",
    "config-schema",
    "config-template",
    "references/screenshots",
    "references/setup",
  ]) {
    const r = RESOURCES.find((x) => x.uri === `appstore-release://${legacy}`);
    assert.ok(r, legacy);
    assert.ok(r.load().length > 100, `${legacy} loads`);
  }
  for (const r of RESOURCES) assert.ok(r.load().length > 0, r.uri);
});
