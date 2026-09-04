#!/usr/bin/env node
// MCP server. Ten outcome-shaped tools and six resources, over stdio.
//
// Credentials come from this process's environment and never from a tool
// argument. Tool arguments are model-visible and end up in transcripts, host
// logs and telemetry; a .p8 private key there is an unrecoverable leak, because
// rotating the key breaks every other integration using it.

import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildTools } from "./tools.mjs";
import { RESOURCES } from "./resources.mjs";

const version = createRequire(import.meta.url)("../../package.json").version;

/**
 * Build the server. Deliberately succeeds without credentials: a server that
 * dies at startup looks broken to the host, and the model cannot then tell the
 * user what is actually missing. Each tool reports the gap instead.
 *
 * @param {{ env?: Record<string, string|undefined> }} [opts]
 */
export function createServer({ env = process.env } = {}) {
  const server = new McpServer(
    { name: "appstore-release", version },
    {
      instructions:
        "Ship an iOS app to App Store review. Start with asc_readiness_report: it returns a verdict and an " +
        "ordered list of next actions, each marked as something this tool can fix or something only a human in " +
        "App Store Connect can do. Apply changes with asc_apply_release (dry-run it first with asc_plan_release). " +
        "Every mutating tool requires confirm: true, which you should set only after the user has agreed. " +
        "Read appstore-release://gotchas before diagnosing any App Store Connect error.",
    },
  );

  const tools = buildTools({
    env,
    allowLocalWrites: env.APPSTORE_RELEASE_ALLOW_LOCAL_WRITES === "1",
  });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        try {
          return await tool.run(args ?? {});
        } catch (e) {
          // Surface the failure as a tool error the model can read and act on,
          // rather than a transport-level fault it cannot see.
          const message = e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text", text: `Failed: ${message}` }], isError: true };
        }
      },
    );
  }

  for (const resource of RESOURCES) {
    server.registerResource(
      resource.name,
      resource.uri,
      { title: resource.title, description: resource.description, mimeType: resource.mimeType },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: resource.mimeType, text: resource.load() }],
      }),
    );
  }

  return server;
}

export async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
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
    console.error(`appstore-release-mcp failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
