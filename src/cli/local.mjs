// Commands that need no credentials and touch no network: they exist so an agent
// can author a valid config before it has anything to authenticate with.

import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { Exit } from "../core/status.mjs";
import { validateConfig } from "../core/requirements.mjs";
import { findConfigPath, loadConfig } from "../core/config.mjs";
import { renderFindings } from "./render.mjs";

const require = createRequire(import.meta.url);
const SCHEMA_PATH = "../../schemas/config.schema.json";
const TEMPLATE_PATH = "../../skills/appstore-release/references/config-template.json";

/** Print the config JSON Schema, so an editor or a model can consume it. */
export function schemaCommand(stdout) {
  stdout.write(JSON.stringify(require(SCHEMA_PATH), null, 2) + "\n");
  return Exit.OK;
}

/**
 * Scaffold a config next to the user's project. Refuses to overwrite: this file
 * holds hand-written store copy, and silently replacing it would be unforgivable.
 */
export function initCommand({ stdout, stderr, cwd, target = "appstore.config.json" }) {
  const path = resolve(cwd, target);
  if (existsSync(path)) {
    stderr.write(`✗ ${target} already exists. Delete it first, or pass a different path.\n`);
    return Exit.USAGE;
  }

  const template = readFileSync(require.resolve(TEMPLATE_PATH), "utf8");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, template);

  stdout.write(
    `Wrote ${target}\n\n` +
      `Next:\n` +
      `  1. Fill it in. Your editor will autocomplete from the $schema on the first line.\n` +
      `  2. Add it to .gitignore — it carries your App Review contact details.\n` +
      `  3. export ASC_KEY_ID / ASC_ISSUER_ID / ASC_P8_PATH / ASC_APP_ID\n` +
      `  4. appstore-release check\n`,
  );
  return Exit.OK;
}

/** Validate a config without credentials or a network. */
export function validateCommand({ stdout, stderr, cwd, env, explicit }) {
  const path = findConfigPath({ explicit, env, cwd });
  if (!path) {
    stderr.write("✗ No config found. Create one with `appstore-release init`.\n");
    return Exit.CONFIG;
  }

  let config;
  try {
    ({ config } = loadConfig(path));
  } catch (e) {
    stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`);
    return Exit.CONFIG;
  }

  const { valid, findings } = validateConfig(config);
  if (valid && !findings.length) {
    stdout.write(`✓ ${path} is valid\n`);
    return Exit.OK;
  }
  renderFindings(valid ? stdout : stderr, findings);
  return valid ? Exit.OK : Exit.CONFIG;
}
