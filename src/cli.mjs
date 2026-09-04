#!/usr/bin/env node
// Single entrypoint / dispatcher.
//
//   node cli.mjs status                 read-only overview
//   node cli.mjs check                  readiness report (what's missing + manual steps)
//   node cli.mjs credentials            generate a fresh distribution cert + profile
//   node cli.mjs <command>              run one listing command (metadata, pricing, ...)
//   node cli.mjs release                run the whole listing pipeline, then check
//   node cli.mjs submit --submit        submit the app version for review
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_P8_PATH, ASC_APP_ID, APPSTORE_CONFIG.
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
  status, check, credentials, submit,
  "attach-build": attachBuild, metadata, pricing,
  "content-rights": contentRights, "age-rating": ageRating,
  category, "review-info": reviewInfo, screenshots, subscription,
};

// Order of the listing pipeline (`release`). Each is idempotent; a build must exist.
const PIPELINE = ["attach-build", "metadata", "pricing", "content-rights", "age-rating", "category", "review-info", "screenshots", "subscription"];

function parseOptions(argv) {
  return { submit: argv.includes("--submit"), json: argv.includes("--json") };
}

async function runOne(cmd, ctx) {
  try {
    const res = await cmd.run(ctx);
    ctx.log.result({ id: cmd.meta.id, title: cmd.meta.title, ...res });
    return res.status;
  } catch (e) {
    ctx.log.result({ id: cmd.meta.id, title: cmd.meta.title, status: Status.ERROR, message: e.message });
    return Status.ERROR;
  }
}

async function main() {
  const [, , name = "status", ...rest] = process.argv;
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
      process.exit(1);
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
  process.exit(ctx.log.hasErrors() ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
