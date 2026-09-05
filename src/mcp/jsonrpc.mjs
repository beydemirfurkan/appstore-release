// Newline-delimited JSON-RPC 2.0 over a pair of streams.
//
// This is the whole transport. MCP over stdio is one JSON object per line, which
// is little enough that carrying a dependency (and its dependency tree) for it
// would cost more than it saves — the package ships with nothing to install,
// which is what lets a plain `git clone` run the server.

/** JSON-RPC error codes, plus the two MCP adds. */
export const ErrorCode = Object.freeze({
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
});

export class RpcError extends Error {
  /** @param {number} code @param {string} message @param {any} [data] */
  constructor(code, message, data) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

/**
 * Serve JSON-RPC requests from `input`, writing responses to `output`.
 *
 * @param {{
 *   input: NodeJS.ReadableStream,
 *   output: { write: (s: string) => any },
 *   handlers: Record<string, (params: any) => any>,
 *   onError?: (e: unknown) => void,
 * }} opts
 * @returns {{ closed: Promise<void> }}
 */
export function serve({ input, output, handlers, onError }) {
  let buffer = "";

  const send = (message) => output.write(JSON.stringify(message) + "\n");

  const respond = (id, result) => send({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message, data) =>
    send({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });

  async function dispatch(message) {
    // A notification has no id and takes no response — including when it fails.
    const isNotification = message.id === undefined || message.id === null;

    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      if (!isNotification) fail(message.id, ErrorCode.InvalidRequest, "Invalid Request");
      return;
    }

    const handler = handlers[message.method];
    if (!handler) {
      if (!isNotification) fail(message.id, ErrorCode.MethodNotFound, "Method not found");
      return;
    }

    try {
      const result = await handler(message.params ?? {});
      if (!isNotification) respond(message.id, result ?? {});
    } catch (e) {
      onError?.(e);
      if (isNotification) return;
      if (e instanceof RpcError) fail(message.id, e.code, e.message, e.data);
      else fail(message.id, ErrorCode.InternalError, e instanceof Error ? e.message : String(e));
    }
  }

  input.setEncoding?.("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // No id is recoverable from unparseable input, so this is the one error
        // the spec sends with a null id.
        fail(null, ErrorCode.ParseError, "Parse error");
        continue;
      }
      // Batches are legal JSON-RPC but MCP does not use them over stdio.
      if (Array.isArray(message)) {
        for (const m of message) void dispatch(m);
      } else {
        void dispatch(message);
      }
    }
  });

  /** @type {Promise<void>} */
  const closed = new Promise((resolve) => {
    input.on("end", () => resolve());
    input.on("close", () => resolve());
  });

  return { closed };
}
