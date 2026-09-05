// The MCP methods, over the JSON-RPC transport in ./jsonrpc.mjs.
//
// Only what this server actually offers: tools and resources. No sampling, no
// prompts, no roots — advertising a capability we do not implement would be a
// lie a client acts on.

import { RpcError, ErrorCode } from "./jsonrpc.mjs";
import { validateAgainstSchema } from "../core/schema.mjs";

/** Versions this server can speak, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);

export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * @param {{
 *   name: string,
 *   version: string,
 *   instructions?: string,
 *   tools: import("./tools.mjs").ToolDef[],
 *   resources: Array<{uri: string, name: string, title: string, description: string, mimeType: string, load: () => string}>,
 *   onError?: (e: unknown) => void,
 * }} spec
 * @returns {Record<string, (params?: any) => any>}
 */
export function createHandlers({ name, version, instructions, tools, resources, onError }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const byUri = new Map(resources.map((r) => [r.uri, r]));

  return {
    initialize(params) {
      // Echo the client's version when we speak it, otherwise name ours and let
      // the client decide whether it can continue.
      const requested = params?.protocolVersion;
      return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name, version },
        ...(instructions ? { instructions } : {}),
      };
    },

    // Notifications: acknowledged by doing nothing, which is the correct response.
    "notifications/initialized": () => undefined,
    "notifications/cancelled": () => undefined,

    ping: () => ({}),

    "tools/list": () => ({
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      })),
    }),

    async "tools/call"(params) {
      const tool = byName.get(params?.name);
      // A missing or malformed tool call comes back as a tool error rather than
      // a protocol error: the model can read it and correct itself, whereas a
      // JSON-RPC error is a transport fault it never sees.
      if (!tool) return toolError(`Tool ${params?.name} not found`);

      const args = params?.arguments ?? {};
      // No label prefix: the message already names the tool.
      const problems = validateAgainstSchema(args, tool.inputSchema, { label: "" });
      // Only blockers refuse. An unrecognised extra argument is a warning: some
      // hosts decorate arguments, and failing the call over that would be worse
      // than ignoring it.
      const blocking = problems.filter((p) => p.severity === "blocker");
      if (blocking.length) {
        return toolError(`Invalid arguments for ${tool.name}: ${blocking.map((p) => p.title).join("; ")}`);
      }

      try {
        return await tool.run(withDefaults(tool.inputSchema, args));
      } catch (e) {
        onError?.(e);
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },

    "resources/list": () => ({
      resources: resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        title: r.title,
        description: r.description,
        mimeType: r.mimeType,
      })),
    }),

    "resources/templates/list": () => ({ resourceTemplates: [] }),

    "resources/read"(params) {
      const resource = byUri.get(params?.uri);
      if (!resource) throw new RpcError(ErrorCode.InvalidParams, `Resource ${params?.uri} not found`);
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.load() }] };
    },
  };
}

/** @param {string} text */
const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

/** Apply declared defaults, which a JSON Schema describes but does not apply. */
function withDefaults(schema, args) {
  const out = { ...args };
  for (const [key, spec] of Object.entries(schema?.properties ?? {})) {
    if (out[key] === undefined && spec.default !== undefined) out[key] = spec.default;
  }
  return out;
}
