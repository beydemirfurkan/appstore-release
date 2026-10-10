#!/usr/bin/env node
// Serve the stateful fake App Store Connect (test/helpers/fake-asc.mjs) over
// loopback HTTP, so the real CLI can be recorded against it for the README.
// Nothing here talks to Apple; the CLI reaches it via APPSTORE_RELEASE_API_BASE,
// which the client honours for loopback addresses only.
//
//   node scripts/demo/server.mjs [port]      default 4010

import { createServer } from "node:http";
import { createFakeAsc } from "../../test/helpers/fake-asc.mjs";

const port = Number(process.argv[2] ?? 4010);
const base = `http://127.0.0.1:${port}`;
const fake = createFakeAsc({ baseUrl: base });

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const response = await fake.fetchImpl(`${base}${req.url}`, {
    method: req.method,
    // JSON for the API, raw bytes for uploads (the fake reads their pixel size).
    body: !body.length ? undefined : req.url?.startsWith("/__upload/") ? body : body.toString("utf8"),
  });
  // A little latency, so the recording looks like the network it stands in for.
  await new Promise((r) => setTimeout(r, 25));
  res.writeHead(response.status, { "content-type": "application/json" });
  res.end(await response.text());
}).listen(port, "127.0.0.1", () => process.stderr.write(`fake App Store Connect on ${base}\n`));
