#!/usr/bin/env node
// Run every test/*.test.mjs. The list is built here rather than by a shell glob:
// Windows shells do not expand one, and Node 20's test runner does not either.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(join(ROOT, "test"))
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => join("test", f));
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
