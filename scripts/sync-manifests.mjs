#!/usr/bin/env node
// package.json is the only place a version or a product description is typed.
// This writes it into the Claude Code manifests, every skill's frontmatter and
// the skill launcher, and copies that launcher into each skill. With --check it
// fails instead of writing — the CI gate that keeps them from drifting apart.
//
//   node scripts/sync-manifests.mjs           rewrite the manifests
//   node scripts/sync-manifests.mjs --check   exit 1 if anything is stale
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const pkg = readJson("package.json");

/** Files we own, and the fields we derive from package.json. */
const TARGETS = [
  {
    path: ".claude-plugin/plugin.json",
    apply: (m) => ({ ...m, name: pkg.name, description: pkg.description, version: pkg.version, license: pkg.license }),
  },
  {
    path: ".claude-plugin/marketplace.json",
    apply: (m) => ({
      ...m,
      plugins: m.plugins.map((p) =>
        p.name === pkg.name ? { ...p, description: pkg.description, version: pkg.version } : p,
      ),
    }),
  },
];

const stale = [];
for (const { path, apply } of TARGETS) {
  const current = readJson(path);
  const next = apply(current);
  const before = JSON.stringify(current, null, 2);
  const after = JSON.stringify(next, null, 2);
  if (before === after) continue;
  stale.push(path);
  if (!check) writeFileSync(join(ROOT, path), after + "\n");
}

/** Write `next` to `rel` if it differs; record it as stale either way. */
const syncText = (/** @type {string} */ rel, /** @type {string} */ next) => {
  const abs = join(ROOT, rel);
  const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  if (current === next) return;
  stale.push(rel);
  if (check) return;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next);
};

// The launcher pins the CLI it fetches to this version, so the instructions a
// skill gives and the commands it runs cannot disagree.
const LAUNCHER = "scripts/skill-launcher.mjs";
const launcher = readFileSync(join(ROOT, LAUNCHER), "utf8").replace(
  /^export const VERSION = "[^"]*";$/m,
  `export const VERSION = "${pkg.version}";`,
);
syncText(LAUNCHER, launcher);

const skillDirs = readdirSync(join(ROOT, "skills")).filter((d) => statSync(join(ROOT, "skills", d)).isDirectory());
for (const name of skillDirs) {
  // Each skill is installed on its own, so each carries its own launcher copy.
  syncText(`skills/${name}/scripts/asc.mjs`, launcher);

  const rel = `skills/${name}/SKILL.md`;
  const source = readFileSync(join(ROOT, rel), "utf8");
  const fm = /^---\n[\s\S]*?\n---\n/.exec(source);
  if (!fm || !/^ {2}version: .*$/m.test(fm[0])) {
    console.error(`✗ ${rel} has no metadata.version line in its frontmatter`);
    process.exitCode = 1;
    continue;
  }
  const stamped = fm[0].replace(/^ {2}version: .*$/m, `  version: "${pkg.version}"`);
  syncText(rel, stamped + source.slice(fm[0].length));
}

// SKILL.md carries a *trigger* description written for the agent, deliberately
// different from the product description — only its identity is checked.
const skill = readFileSync(join(ROOT, "skills/appstore-release/SKILL.md"), "utf8");
const skillName = /^name:\s*(.+)$/m.exec(skill)?.[1]?.trim();
if (skillName !== pkg.name) {
  console.error(`✗ skills/appstore-release/SKILL.md declares name "${skillName}", expected "${pkg.name}"`);
  process.exitCode = 1;
}

// Diagnostics go to stderr: this runs as a prepack hook, and anything on stdout
// corrupts `npm pack --json`.
if (check && stale.length) {
  console.error(`✗ stale manifests: ${stale.join(", ")}\n  run: npm run manifests:sync`);
  process.exitCode = 1;
} else if (stale.length) {
  console.error(`✓ synced ${stale.join(", ")} to ${pkg.name}@${pkg.version}`);
} else if (!process.exitCode) {
  console.error(`✓ manifests already at ${pkg.name}@${pkg.version}`);
}
