// Resources an agent can read on demand. The gotchas file is the most valuable
// thing in this package: it is the accumulated cost of every App Store Connect
// error someone hit in production, and exposing it here is what lets a model in
// Cursor or Zed benefit from it, not only the Claude Code skill.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

/** @type {Array<{uri: string, name: string, title: string, description: string, mimeType: string, load: () => string}>} */
export const RESOURCES = [
  {
    uri: "appstore-release://gotchas",
    name: "gotchas",
    title: "App Store Connect pitfalls",
    description:
      "Every failure mode hit in practice, with the exact error text and the fix: emoji in the description, " +
      "whatsNew on a first version, the age-rating attribute set, the reserve/upload/commit dance, the two " +
      "things Apple keeps UI-only. Read this before diagnosing any 409.",
    mimeType: "text/markdown",
    load: () => read("skills/appstore-release/references/gotchas.md"),
  },
  {
    uri: "appstore-release://runbook",
    name: "runbook",
    title: "Submission runbook",
    description: "The end-to-end procedure for getting an iOS app through App Review.",
    mimeType: "text/markdown",
    load: () => read("skills/appstore-release/SKILL.md"),
  },
  {
    uri: "appstore-release://config-schema",
    name: "config-schema",
    title: "Config JSON Schema",
    description: "The full shape of the config file, with a description on every field. Use it to author one.",
    mimeType: "application/json",
    load: () => JSON.stringify(require("../../schemas/config.schema.json"), null, 2),
  },
  {
    uri: "appstore-release://config-template",
    name: "config-template",
    title: "Config template",
    description: "A filled-in starting point matching the schema.",
    mimeType: "application/json",
    load: () => read("skills/appstore-release/references/config-template.json"),
  },
  {
    uri: "appstore-release://references/screenshots",
    name: "screenshots-guide",
    title: "Producing App Store screenshots",
    description: "How to render exact-size, alpha-free PNGs for each display type.",
    mimeType: "text/markdown",
    load: () => read("skills/appstore-release/references/screenshots.md"),
  },
  {
    uri: "appstore-release://references/setup",
    name: "setup-guide",
    title: "Getting an App Store Connect API key",
    description: "Creating the key, the role it needs, and where the ids come from.",
    mimeType: "text/markdown",
    load: () => read("skills/appstore-release/references/setup.md"),
  },
];

/** @param {string} rel */
function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}
