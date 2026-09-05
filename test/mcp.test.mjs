import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createServer } from "../src/mcp/server.mjs";
import { buildTools } from "../src/mcp/tools.mjs";
import { RESOURCES } from "../src/mcp/resources.mjs";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "../src/mcp/protocol.mjs";
import { serve, ErrorCode } from "../src/mcp/jsonrpc.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "../src/mcp/server.mjs");

/** Call the handlers directly — fast, and where most of the behaviour lives. */
function connect(env = {}) {
  const handlers = createServer({ env });
  return {
    handlers,
    /** @returns {Promise<any>} */
    request: async (method, params = {}) => handlers[method](params),
    /** @returns {Promise<any[]>} */
    tools: async () => (await handlers["tools/list"]()).tools,
    /** @returns {Promise<any>} */
    call: async (name, args = {}) => handlers["tools/call"]({ name, arguments: args }),
    /** @returns {Promise<any>} */
    read: async (uri) => handlers["resources/read"]({ uri }),
  };
}

/** @param {any[]} tools @param {string} name */
function tool(tools, name) {
  const found = tools.find((t) => t.name === name);
  assert.ok(found, `no tool named ${name}`);
  return found;
}

const MUTATING = [
  "asc_open_next_version",
  "asc_apply_release",
  "asc_upload_screenshots",
  "asc_configure_subscription",
  "asc_submit_for_review",
  "asc_generate_credentials",
];

// ── the tool surface ──────────────────────────────────────────────────────────

test("the tool surface is exactly this, and grows only on purpose", async () => {
  const tools = await connect().tools();
  // The count is a product decision, so it is pinned. asc_open_next_version was
  // the eleventh, added because without it an agent that hit version.none had no
  // way forward at all — every other tool needs an editable version to act on.
  assert.equal(tools.length, 11, tools.map((t) => t.name).join(", "));
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "asc_app_overview",
    "asc_apply_release",
    "asc_configure_subscription",
    "asc_generate_credentials",
    "asc_list_apps",
    "asc_open_next_version",
    "asc_plan_release",
    "asc_readiness_report",
    "asc_submit_for_review",
    "asc_upload_screenshots",
    "asc_validate_config",
  ]);
});

test("every tool ships a usable JSON Schema and honest annotations", async () => {
  const tools = await connect().tools();
  for (const t of tools) {
    assert.ok(t.annotations, `${t.name} has no annotations`);
    assert.equal(typeof t.annotations.readOnlyHint, "boolean", t.name);
    assert.equal(typeof t.annotations.destructiveHint, "boolean", t.name);
    assert.ok(t.description.length > 40, `${t.name} needs a description a model can choose on`);

    assert.equal(t.inputSchema.type, "object", `${t.name} inputSchema must be an object schema`);
    for (const [key, spec] of Object.entries(t.inputSchema.properties)) {
      assert.ok(spec.description, `${t.name}.${key} has no description`);
      assert.ok(spec.type, `${t.name}.${key} has no type`);
    }
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

test("every mutating tool requires confirm: true and refuses without it", async () => {
  const mcp = connect();
  const tools = await mcp.tools();
  for (const name of MUTATING) {
    const t = tool(tools, name);
    assert.ok(t.inputSchema.required?.includes("confirm"), `${name} does not require confirm`);
    assert.equal(t.inputSchema.properties.confirm.const, true, `${name} accepts confirm other than true`);

    const missing = await mcp.call(name);
    assert.equal(missing.isError, true, `${name} ran without confirmation`);
    assert.match(missing.content[0].text, /confirm/);

    // And `false` is not a way around it.
    const refused = await mcp.call(name, { confirm: false });
    assert.equal(refused.isError, true, `${name} accepted confirm: false`);
  }
});

test("no read-only tool requires confirmation", async () => {
  const tools = await connect().tools();
  for (const t of tools.filter((x) => x.annotations.readOnlyHint)) {
    assert.ok(!t.inputSchema.required?.includes("confirm"), `${t.name} should not demand confirmation`);
  }
});

test("no tool accepts a private key as an argument", async () => {
  // Tool arguments are model-visible and land in transcripts and host logs. A
  // leaked .p8 cannot be rotated without breaking every other integration.
  const tools = await connect().tools();
  for (const t of tools) {
    for (const key of Object.keys(t.inputSchema.properties ?? {})) {
      assert.ok(
        !/p8|privatekey|secret|password|issuerid|keyid/i.test(key),
        `${t.name} accepts "${key}" — credentials must come from the environment only`,
      );
    }
  }
});

test("an unknown tool is a tool error, not a protocol error", async () => {
  // A model can read and correct a tool error; a JSON-RPC error it never sees.
  const res = await connect().call("no_such_tool");
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not found/);
});

// ── behaviour without credentials ─────────────────────────────────────────────

test("the server works without credentials and each tool explains the gap", async () => {
  const mcp = connect({});
  const res = await mcp.call("asc_readiness_report");
  assert.notEqual(res.isError, true, "a missing key is not a malfunction");
  assert.match(res.content[0].text, /ASC_KEY_ID/);
  assert.equal(res.structuredContent.configured, false);
});

test("asc_validate_config needs neither credentials nor a network", async () => {
  const res = await connect({}).call("asc_validate_config", {
    config: { locale: "en-US", metadata: { description: "Great 🎉" } },
  });
  assert.equal(res.structuredContent.valid, false);
  assert.match(res.content[0].text, /emoji/i);
});

test("asc_generate_credentials stays off until the operator turns it on", async () => {
  const refused = await connect({}).call("asc_generate_credentials", { confirm: true });
  assert.match(refused.content[0].text, /APPSTORE_RELEASE_ALLOW_LOCAL_WRITES/);
  assert.equal(refused.structuredContent.confirmed, false);

  const allowed = await connect({ APPSTORE_RELEASE_ALLOW_LOCAL_WRITES: "1" }).call("asc_generate_credentials", {
    confirm: true,
  });
  assert.match(allowed.content[0].text, /ASC_KEY_ID/);
});

test("screenshot pruning is opt-in for a model, unlike the CLI", async () => {
  const shots = tool(buildTools({ env: {} }), "asc_upload_screenshots");
  // The CLI prunes by default because a human typed the command. A model should
  // not discover deletion by leaving an argument out.
  assert.equal(shots.inputSchema.properties.prune.default, false);
});

// ── resources ─────────────────────────────────────────────────────────────────

test("the six resources are listed and readable", async () => {
  const mcp = connect();
  const { resources } = await mcp.request("resources/list");
  assert.equal(resources.length, RESOURCES.length);
  assert.equal(resources.length, 6);

  const gotchas = await mcp.read("appstore-release://gotchas");
  assert.match(gotchas.contents[0].text, /Gotchas/);

  const schema = await mcp.read("appstore-release://config-schema");
  assert.equal(JSON.parse(schema.contents[0].text).title, "appstore-release config");
});

test("an unknown resource is a protocol error, since the URI came from our own list", async () => {
  await assert.rejects(() => connect().read("appstore-release://nope"), /not found/);
});

// ── the protocol itself ───────────────────────────────────────────────────────

test("initialize echoes a version we speak, and names ours when we do not", async () => {
  const mcp = connect();
  const negotiated = await mcp.request("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(negotiated.protocolVersion, "2025-06-18");
  assert.equal(negotiated.serverInfo.name, "appstore-release");
  assert.match(negotiated.serverInfo.version, /^\d+\.\d+\.\d+$/);
  assert.ok(negotiated.instructions.includes("asc_readiness_report"));

  const fallback = await mcp.request("initialize", { protocolVersion: "1999-01-01" });
  assert.equal(fallback.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(LATEST_PROTOCOL_VERSION));
});

test("we advertise only what we implement", async () => {
  const { capabilities } = await connect().request("initialize", {});
  assert.deepEqual(Object.keys(capabilities).sort(), ["resources", "tools"]);
  // Claiming listChanged without ever sending the notification would be a lie a
  // client acts on.
  assert.equal(capabilities.tools.listChanged, false);
  assert.equal(capabilities.resources.listChanged, false);
});

// ── the transport ─────────────────────────────────────────────────────────────

/** Talk to a spawned server over real stdio, the way a host does. */
async function overStdio(messages, { env = {} } = {}) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH, ...env },
  });
  const received = [];
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) received.push(JSON.parse(line));
    }
  });
  for (const m of messages) child.stdin.write(typeof m === "string" ? m : JSON.stringify(m) + "\n");
  child.stdin.end();
  await new Promise((resolve) => child.on("close", () => resolve(undefined)));
  return received;
}

test("a spawned server speaks the protocol over stdio", async () => {
  const got = await overStdio([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "ping" },
  ]);
  assert.deepEqual(
    got.map((m) => m.id),
    [1, 2, 3],
    "a notification must produce no response",
  );
  assert.equal(got[0].result.protocolVersion, "2025-06-18");
  assert.equal(got[1].result.tools.length, 11);
  assert.deepEqual(got[2].result, {});
});

test("messages split across chunks are reassembled", async () => {
  // stdin delivers bytes, not lines; a request larger than one chunk is normal.
  const message = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" });
  const got = await overStdio([message.slice(0, 12), message.slice(12) + "\n"]);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 7);
});

test("malformed input is reported and does not kill the session", async () => {
  const got = await overStdio(["{not json\n", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }) + "\n"]);
  assert.equal(got[0].error.code, ErrorCode.ParseError);
  assert.equal(got[0].id, null);
  assert.equal(got[1].id, 2, "the connection survives a bad line");
});

test("an unknown method is a JSON-RPC error, and an unknown notification is silence", async () => {
  const got = await overStdio([
    { jsonrpc: "2.0", id: 1, method: "no/such/method" },
    { jsonrpc: "2.0", method: "notifications/whatever" },
    { jsonrpc: "2.0", id: 2, method: "ping" },
  ]);
  assert.equal(got[0].error.code, ErrorCode.MethodNotFound);
  assert.deepEqual(
    got.map((m) => m.id),
    [1, 2],
  );
});

test("nothing but protocol reaches stdout", async () => {
  // A stray console.log corrupts the stream and the host sees a parse error.
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH } });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", arguments: {} }) + "\n");
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "asc_readiness_report", arguments: {} },
    }) + "\n",
  );
  child.stdin.end();
  await new Promise((resolve) => child.on("close", () => resolve(undefined)));
  for (const line of stdout.trim().split("\n")) {
    assert.doesNotThrow(() => JSON.parse(line), `non-protocol output on stdout: ${line}`);
  }
});

test("the transport can be driven over any stream pair", async () => {
  // serve() takes streams, so it is testable without a process at all.
  const { Readable } = await import("node:stream");
  const written = [];
  const input = Readable.from([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n"]);
  serve({ input, output: { write: (s) => written.push(s) }, handlers: { ping: () => ({ pong: true }) } });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(JSON.parse(written[0]), { jsonrpc: "2.0", id: 1, result: { pong: true } });
});
