// Resources an agent can read on demand. The gotchas file is the most valuable
// thing in this package: it is the accumulated cost of every App Store Connect
// error someone hit in production, and exposing it here is what lets a model in
// Cursor or Zed benefit from it, not only an agent that loads skills.
//
// Every skill under skills/ is served too — its SKILL.md and each reference —
// discovered from disk, so a new skill or reference needs no change here. The
// six fixed URIs from v2 stay as stable aliases.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

/** @typedef {{uri: string, name: string, title: string, description: string, mimeType: string, load: () => string}} Resource */

/** @type {Resource[]} */
const ALIASES = [
  {
    uri: "appstore-release://gotchas",
    name: "gotchas",
    title: "App Store Connect pitfalls",
    description:
      "Every failure mode hit in practice, with the exact error text and the fix: emoji in the description, " +
      "whatsNew on a first version, the age-rating attribute set, the Asset Library upload and placement rules, " +
      "the one thing Apple keeps UI-only. Read this before diagnosing any 409.",
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
    description: "How to render exact-size, alpha-free images for each device, iPhone Duo included.",
    mimeType: "text/markdown",
    load: () => read("skills/asc-screenshots/references/producing.md"),
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

/** @type {Resource[]} */
export const RESOURCES = [...ALIASES, ...skillResources()];

/**
 * One resource per SKILL.md and per reference file:
 *   appstore-release://skills/<skill>
 *   appstore-release://skills/<skill>/references/<file>
 *
 * @returns {Resource[]}
 */
function skillResources() {
  const skillsDir = join(ROOT, "skills");
  if (!existsSync(skillsDir)) return [];
  /** @type {Resource[]} */
  const out = [];
  for (const skill of readdirSync(skillsDir).sort()) {
    const dir = join(skillsDir, skill);
    if (!existsSync(join(dir, "SKILL.md"))) continue;
    const skillMd = `skills/${skill}/SKILL.md`;
    out.push({
      uri: `appstore-release://skills/${skill}`,
      name: `skill-${skill}`,
      title: `Skill: ${skill}`,
      description: frontmatterField(read(skillMd), "description") || `The ${skill} skill.`,
      mimeType: "text/markdown",
      load: () => read(skillMd),
    });
    for (const file of listFiles(join(dir, "references"))) {
      const rel = relative(ROOT, file).split(sep).join("/");
      const refPath = relative(dir, file).split(sep).join("/");
      out.push({
        uri: `appstore-release://skills/${skill}/${refPath}`,
        name: `${skill}-${basename(file, extname(file))}`,
        title: `${skill}: ${basename(file)}`,
        description: `Reference for the ${skill} skill (${refPath}).`,
        mimeType: extname(file) === ".json" ? "application/json" : "text/markdown",
        load: () => read(rel),
      });
    }
  }
  return out;
}

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? listFiles(p) : [p];
    });
}

/** @param {string} md @param {string} key */
function frontmatterField(md, key) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "";
  const line = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fm)?.[1]?.trim() ?? "";
  return line.replace(/^"(.*)"$/, "$1");
}

/** @param {string} rel */
function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}
