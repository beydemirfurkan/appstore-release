import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../src/mcp/server.mjs";
import { buildTools } from "../src/mcp/tools.mjs";
import { RESOURCES } from "../src/mcp/resources.mjs";

/**
 * A connected client/server pair with no credentials in the environment.
 * The SDK's result types are wide unions; narrowing them once here keeps every
 * assertion below about behaviour rather than about type guards.
 */
async function connect(env = {}) {
  const server = createServer({ env });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    server,
    /** @returns {Promise<any[]>} */
    async tools() {
      return (await client.listTools()).tools;
    },
    /** @returns {Promise<any>} */
    async call(name, args = {}) {
      return await client.callTool({ name, arguments: args });
    },
    /** @returns {Promise<any>} */
    async read(uri) {
      return await client.readResource({ uri });
    },
  };
}

/** @param {any[]} tools @param {string} name */
function tool(tools, name) {
  const found = tools.find((t) => t.name === name);
  assert.ok(found, `no tool named ${name}`);
  return found;
}

const MUTATING = [
  "asc_apply_release",
  "asc_upload_screenshots",
  "asc_configure_subscription",
  "asc_submit_for_review",
  "asc_generate_credentials",
];

test("the server exposes exactly ten tools", async () => {
  const mcp = await connect();
  const tools = await mcp.tools();
  // The number is the product decision, so it gets a test. Adding an eleventh
  // should be a deliberate act, not a drift.
  assert.equal(tools.length, 10, tools.map((t) => t.name).join(", "));
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "asc_app_overview",
    "asc_apply_release",
    "asc_configure_subscription",
    "asc_generate_credentials",
    "asc_list_apps",
    "asc_plan_release",
    "asc_readiness_report",
    "asc_submit_for_review",
    "asc_upload_screenshots",
    "asc_validate_config",
  ]);
});

test("every tool declares annotations, and the read-only ones are honest", async () => {
  const tools = await (await connect()).tools();
  for (const t of tools) {
    assert.ok(t.annotations, `${t.name} has no annotations`);
    assert.equal(typeof t.annotations.readOnlyHint, "boolean", `${t.name}`);
    assert.equal(typeof t.annotations.destructiveHint, "boolean", `${t.name}`);
    assert.ok(t.description.length > 40, `${t.name} needs a description a model can choose on`);
  }
  const readOnly = tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
  assert.deepEqual(readOnly.sort(), [
    "asc_app_overview",
    "asc_list_apps",
    "asc_plan_release",
    "asc_readiness_report",
    "asc_validate_config",
  ]);
  for (const name of MUTATING) {
    assert.equal(tool(tools, name).annotations.readOnlyHint, false, `${name} must not claim to be read-only`);
  }
});

test("every mutating tool requires confirm: true and cannot be called without it", async () => {
  const mcp = await connect();
  const tools = await mcp.tools();
  for (const name of MUTATING) {
    const t = tool(tools, name);
    assert.ok(t.inputSchema.required?.includes("confirm"), `${name} does not require confirm`);
    assert.equal(t.inputSchema.properties.confirm.const, true, `${name} accepts confirm other than true`);

    // And the protocol enforces it, not just the schema on paper.
    const res = await mcp.call(name);
    assert.equal(res.isError, true, `${name} ran without confirmation`);
  }
});

test("no read-only tool requires confirmation", async () => {
  const tools = await (await connect()).tools();
  for (const t of tools.filter((x) => x.annotations.readOnlyHint)) {
    assert.ok(!t.inputSchema.required?.includes("confirm"), `${t.name} should not demand confirmation`);
  }
});

test("no tool accepts a private key as an argument", async () => {
  // Tool arguments are model-visible and land in transcripts and host logs. A
  // leaked .p8 cannot be rotated without breaking every other integration.
  const tools = await (await connect()).tools();
  for (const t of tools) {
    for (const key of Object.keys(t.inputSchema.properties ?? {})) {
      assert.ok(
        !/p8|privatekey|secret|password|issuerid|keyid/i.test(key),
        `${t.name} accepts "${key}" — credentials must come from the environment only`,
      );
    }
  }
});

test("the server starts without credentials and each tool explains the gap", async () => {
  // A server that dies at startup looks broken to the host, and the model then
  // cannot tell the user what is missing.
  const mcp = await connect({});
  const res = await mcp.call("asc_readiness_report");
  assert.notEqual(res.isError, true);
  assert.match(res.content[0].text, /ASC_KEY_ID/);
  assert.equal(res.structuredContent.configured, false);
});

test("asc_validate_config works with no credentials at all", async () => {
  const mcp = await connect({});
  const res = await mcp.call("asc_validate_config", {
    config: { locale: "en-US", metadata: { description: "Great 🎉" } },
  });
  assert.equal(res.structuredContent.valid, false);
  assert.match(res.content[0].text, /emoji/i);
});

test("asc_generate_credentials stays off until the operator turns it on", async () => {
  const off = await connect({});
  const refused = await off.call("asc_generate_credentials", { confirm: true });
  assert.match(refused.content[0].text, /APPSTORE_RELEASE_ALLOW_LOCAL_WRITES/);
  assert.equal(refused.structuredContent.confirmed, false);

  // With the flag on it proceeds far enough to complain about credentials instead.
  const on = await connect({ APPSTORE_RELEASE_ALLOW_LOCAL_WRITES: "1" });
  const allowed = await on.call("asc_generate_credentials", { confirm: true });
  assert.match(allowed.content[0].text, /ASC_KEY_ID/);
});

test("screenshot pruning is opt-in for a model, unlike the CLI", async () => {
  const shots = tool(buildTools({ env: {} }), "asc_upload_screenshots");
  // The CLI prunes by default because a human typed the command. A model should
  // not discover deletion by leaving an argument out.
  assert.equal(shots.inputSchema.prune.def.defaultValue, false);
});

test("the six resources are listed and readable", async () => {
  const mcp = await connect();
  const { resources } = await mcp.client.listResources();
  assert.equal(resources.length, RESOURCES.length);
  assert.equal(resources.length, 6);

  const gotchas = await mcp.read("appstore-release://gotchas");
  assert.match(gotchas.contents[0].text, /Gotchas/);

  const schema = await mcp.read("appstore-release://config-schema");
  assert.equal(JSON.parse(schema.contents[0].text).title, "appstore-release config");
});
