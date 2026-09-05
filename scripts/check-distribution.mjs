#!/usr/bin/env node
// The distribution promise, enforced.
//
// This package is not published to any registry: you clone it and run it. That
// only stays true if nothing in src/ ever imports something that would have to
// be installed first — which is easy to break by accident and invisible on a
// machine that happens to have node_modules lying around.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = createRequire(import.meta.url)("../package.json");
const problems = [];

// 1. No runtime dependencies at all.
const deps = Object.keys(pkg.dependencies ?? {});
if (deps.length) problems.push(`package.json declares runtime dependencies: ${deps.join(", ")}`);

// 2. Nothing under src/ imports anything but node: builtins and relative paths.
const IMPORT_RE = /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']|(?:^|\W)require\(\s*["']([^"']+)["']\s*\)/g;
for (const file of walk(join(ROOT, "src"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    const local = specifier.startsWith(".") || specifier.startsWith("node:") || specifier.endsWith(".json");
    if (!local) problems.push(`${file.slice(ROOT.length + 1)} imports "${specifier}"`);
  }
}

// 3. No secret-shaped file is tracked. The repository is public.
const SECRET_RE = /\.p8$|\.p12$|\.mobileprovision$|credentials\.json$|^secrets\/|appstore\.config\.json$|^\.env/i;
try {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  for (const path of tracked.filter((p) => SECRET_RE.test(p))) problems.push(`secret-shaped file is tracked: ${path}`);
} catch {
  // Not a git checkout (an extracted archive, say) — nothing to check.
}

if (problems.length) {
  console.error("✗ distribution checks failed:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.error(`✓ no runtime dependencies; src/ imports only builtins and relative paths`);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".mjs")) out.push(path);
  }
  return out;
}
