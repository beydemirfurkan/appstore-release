#!/usr/bin/env node
// Single entrypoint / dispatcher.
//
//   appstore-release status              read-only overview
//   appstore-release check               readiness report (what's missing + manual steps)
//   appstore-release credentials         generate a fresh distribution cert + profile
//   appstore-release <command>           run one listing operation (metadata, pricing, ...)
//   appstore-release release             run the whole listing pipeline, then check
//   appstore-release submit --submit     submit the app version for review
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_P8_PATH, ASC_APP_ID, APPSTORE_CONFIG.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createContext } from "./core/context.mjs";
import { Status } from "./core/log.mjs";

import * as status from "./ops/status.mjs";
import * as check from "./ops/check.mjs";
import * as credentials from "./ops/credentials.mjs";
import * as attachBuild from "./ops/attach-build.mjs";
import * as metadata from "./ops/metadata.mjs";
import * as pricing from "./ops/pricing.mjs";
import * as contentRights from "./ops/content-rights.mjs";
import * as ageRating from "./ops/age-rating.mjs";
import * as category from "./ops/category.mjs";
import * as reviewInfo from "./ops/review-info.mjs";
import * as screenshots from "./ops/screenshots.mjs";
import * as subscription from "./ops/subscription.mjs";
import * as submit from "./ops/submit.mjs";

const REGISTRY = {
  status,
  check,
  credentials,
  submit,
  "attach-build": attachBuild,
  metadata,
  pricing,
  "content-rights": contentRights,
  "age-rating": ageRating,
  category,
  "review-info": reviewInfo,
  screenshots,
  subscription,
};

// Order of the listing pipeline (`release`). Each is idempotent; a build must exist.
const PIPELINE = [
  "attach-build",
  "metadata",
  "pricing",
  "content-rights",
  "age-rating",
  "category",
  "review-info",
  "screenshots",
  "subscription",
];

/** @param {unknown} e */
const errorMessage = (e) => (e instanceof Error ? e.message : String(e));

function parseOptions(argv) {
  return { submit: argv.includes("--submit"), json: argv.includes("--json") };
}

async function runOne(cmd, ctx) {
  try {
    const res = await cmd.run(ctx);
    ctx.log.result({ id: cmd.meta.id, title: cmd.meta.title, ...res });
    return res.status;
  } catch (e) {
    ctx.log.result({ id: cmd.meta.id, title: cmd.meta.title, status: Status.ERROR, message: errorMessage(e) });
    return Status.ERROR;
  }
}

/**
 * Run the CLI. Returns an exit code instead of calling process.exit, so the
 * whole dispatcher is importable from tests and from the MCP server.
 *
 * @param {string[]} [argv]  arguments after the node binary and script path
 * @returns {Promise<number>} process exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const [name = "status", ...rest] = argv;
  const options = parseOptions(rest);
  const needsConfig = name !== "status" && name !== "check" && name !== "credentials";
  const ctx = createContext({ requireAppId: true, requireConfig: needsConfig });
  ctx.options = options;

  if (name === "release") {
    ctx.log.section("App Store Release — listing pipeline");
    for (const key of PIPELINE) await runOne(REGISTRY[key], ctx);
    await runOne(check, ctx);
  } else {
    const cmd = REGISTRY[name];
    if (!cmd) {
      console.error(`Unknown command: ${name}\nAvailable: ${Object.keys(REGISTRY).join(", ")}, release`);
      return 1;
    }
    await runOne(cmd, ctx);
  }

  // Surface manual (UI-only) steps prominently and emit a machine-readable summary.
  const manual = ctx.log.manualSteps();
  if (manual.length) {
    ctx.log.section("Manual steps required (Apple has no API for these)");
    manual.forEach((m, i) => ctx.log.info(`${i + 1}. ${m.title} — ${m.message}`));
  }
  if (options.json) console.log("\n" + JSON.stringify({ results: ctx.log.summary() }, null, 2));
  return ctx.log.hasErrors() ? 1 : 0;
}

// Only run when invoked as a program, so tests (and later the MCP server) can import main().
// argv[1] is npm's bin symlink, import.meta.url is the real file — resolve before comparing.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    process.exitCode = await main();
  } catch (e) {
    console.error(`\n✗ ${errorMessage(e)}`);
    process.exitCode = 1;
  }
}
