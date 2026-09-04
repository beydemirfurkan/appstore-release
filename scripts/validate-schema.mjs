#!/usr/bin/env node
// CI gate: the published schema must be valid draft 2020-12, and the template we
// hand people must satisfy it. Our own runtime validator is deliberately small,
// so this is where a real implementation checks our homework.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// ajv ships CJS with a self-referential `.default`; going through it keeps both
// the runtime and the type checker happy.
const Ajv = require("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats").default;

const schema = require("../schemas/config.schema.json");
const template = require("../skills/appstore-release/references/config-template.json");

const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);

let validate;
try {
  validate = ajv.compile(schema);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`✗ schemas/config.schema.json is not valid draft 2020-12:\n  ${message}`);
  process.exit(1);
}

if (!validate(template)) {
  console.error("✗ config-template.json does not satisfy its own schema:");
  for (const err of validate.errors ?? []) console.error(`  ${err.instancePath || "/"} ${err.message}`);
  process.exit(1);
}

// The template is also the thing `init` writes, so a reader must find it useful.
if (!template.$schema) {
  console.error("✗ config-template.json is missing $schema — editors lose autocomplete without it");
  process.exit(1);
}

console.log("✓ schema is valid draft 2020-12 and the template satisfies it");
