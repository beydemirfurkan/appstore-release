#!/usr/bin/env node
// package.json is the only place a version or a product description is typed.
// This writes it into the Claude Code manifests, and with --check fails instead
// of writing — that is the CI gate that keeps them from drifting apart.
//
//   node scripts/sync-manifests.mjs           rewrite the manifests
//   node scripts/sync-manifests.mjs --check   exit 1 if anything is stale
import { readFileSync, writeFileSync } from "node:fs";
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
