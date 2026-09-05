#!/usr/bin/env node
// MCP server. Eleven outcome-shaped tools and six resources, over stdio.
//
// No dependencies: the JSON-RPC layer is ./jsonrpc.mjs and the methods are
// ./protocol.mjs. That is deliberate — a Claude Code plugin is a git clone with
// no install step, so a server that needed node_modules could not run there at
// all. `git clone && node src/mcp/server.mjs` is the whole setup.
//
// Credentials come from this process's environment and never from a tool
// argument. Tool arguments are model-visible and end up in transcripts, host
// logs and telemetry; a .p8 private key there is an unrecoverable leak, because
// rotating the key breaks every other integration using it.

import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { serve } from "./jsonrpc.mjs";
import { createHandlers } from "./protocol.mjs";
import { buildTools } from "./tools.mjs";
import { RESOURCES } from "./resources.mjs";

const version = createRequire(import.meta.url)("../../package.json").version;

const INSTRUCTIONS =
  "Ship an iOS app to App Store review. Start with asc_readiness_report: it returns a verdict and an ordered " +
  "list of next actions, each marked as something this tool can fix or something only a human in App Store " +
  "Connect can do. Apply changes with asc_apply_release (dry-run it first with asc_plan_release). Every " +
  "mutating tool requires confirm: true, which you should set only after the user has agreed. Read " +
  "appstore-release://gotchas before diagnosing any App Store Connect error.";

/**
 * Build the request handlers. Deliberately succeeds without credentials: a
 * server that dies at startup looks broken to the host, and the model cannot
 * then tell the user what is missing. Each tool reports the gap instead.
 *
 * @param {{ env?: Record<string, string|undefined> }} [opts]
 */
export function createServer({ env = process.env } = {}) {
  const tools = buildTools({ env, allowLocalWrites: env.APPSTORE_RELEASE_ALLOW_LOCAL_WRITES === "1" });
  return createHandlers({
    name: "appstore-release",
    version,
    instructions: INSTRUCTIONS,
    tools,
    resources: RESOURCES,
    // stderr, never stdout: stdout is the protocol channel.
    onError: (e) => process.stderr.write(`appstore-release-mcp: ${e instanceof Error ? e.stack : String(e)}\n`),
  });
}

export async function main({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  const { closed } = serve({ input, output, handlers: createServer({ env }) });
  await closed;
}

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
  main().catch((e) => {
    process.stderr.write(`appstore-release-mcp failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
