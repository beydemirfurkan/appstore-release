#!/usr/bin/env node
// The skills are a product surface of their own — skills.sh, Codex, Cursor and
// Claude Code each load them without ever seeing the rest of this repository.
// This gate holds them to the Agent Skills spec (agentskills.io) and to the one
// promise the launcher makes: every skill is installable on its own.
//
//   node scripts/check-skills.mjs        exit 1 on any error; warnings are printed

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LIMITS = Object.freeze({ name: 64, description: 1024, compatibility: 500, lines: 500, softLines: 200 });

/**
 * The subset of YAML that skill frontmatter uses: `key: value` scalars and one
 * level of nested map (`metadata:`). Anything fancier is reported, not guessed at.
 *
 * @param {string} source
 * @returns {{ data: Record<string, any>, body: string, errors: string[] } | null}
 */
export function parseFrontmatter(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return null;
  /** @type {Record<string, any>} */
  const data = {};
  const errors = [];
  /** @type {Record<string, string> | null} */
  let nested = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = /^(\s*)([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    if (!kv) {
      errors.push(`unparseable frontmatter line: ${line}`);
      continue;
    }
    const [, indent, key, raw = ""] = kv;
    const value = unquote(raw.trim());
    if (indent) {
      if (!nested) errors.push(`indented key "${key}" outside a map`);
      else nested[key] = value;
      continue;
    }
    if (raw.trim() === "") {
      nested = {};
      data[key] = nested;
    } else {
      nested = null;
      if (/^[>|]/.test(raw.trim())) errors.push(`"${key}" uses a block scalar; keep it on one line`);
      // A plain scalar containing ": " is invalid YAML to a real parser even
      // though this one would accept it. Quote it.
      if (!/^["']/.test(raw.trim()) && /:\s/.test(raw)) errors.push(`"${key}" contains ": " — quote the value`);
      data[key] = value;
    }
  }
  return { data, body: source.slice(m[0].length), errors };
}

/** @param {string} s */
function unquote(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s[0] === '"' ? JSON.parse(s) : s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** Relative markdown link targets in a document, minus anchors. @param {string} md */
export function relativeLinks(md) {
  const out = [];
  const stripped = md.replace(/```[\s\S]*?```/g, "");
  for (const m of stripped.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    out.push(target.split("#")[0]);
  }
  return out.filter(Boolean);
}

/**
 * @param {string} [root]
 * @returns {{ skills: string[], errors: string[], warnings: string[] }}
 */
export function checkSkills(root = ROOT) {
  const errors = [];
  const warnings = [];
  const skillsDir = join(root, "skills");
  const skills = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());

  const canonicalPath = join(root, "scripts", "skill-launcher.mjs");
  const canonical = existsSync(canonicalPath) ? readFileSync(canonicalPath, "utf8") : null;
  if (!canonical) errors.push("scripts/skill-launcher.mjs is missing");

  for (const name of skills) {
    const dir = join(skillsDir, name);
    const at = (/** @type {string} */ msg) => `skills/${name}: ${msg}`;
    const skillPath = join(dir, "SKILL.md");
    if (!existsSync(skillPath)) {
      errors.push(at("no SKILL.md"));
      continue;
    }
    const source = readFileSync(skillPath, "utf8");
    const fm = parseFrontmatter(source);
    if (!fm) {
      errors.push(at("SKILL.md has no frontmatter"));
      continue;
    }
    for (const e of fm.errors) errors.push(at(e));
    const { data } = fm;

    if (data.name !== name) errors.push(at(`name "${data.name}" must equal the directory name`));
    if (typeof data.name !== "string" || !NAME_RE.test(data.name) || data.name.length > LIMITS.name) {
      errors.push(at(`name "${data.name}" must be 1-${LIMITS.name} chars of a-z, 0-9 and single hyphens`));
    }
    const desc = typeof data.description === "string" ? data.description : "";
    if (!desc || desc.length > LIMITS.description) {
      errors.push(at(`description must be 1-${LIMITS.description} characters (is ${desc.length})`));
    }
    if (typeof data.compatibility === "string" && data.compatibility.length > LIMITS.compatibility) {
      errors.push(at(`compatibility exceeds ${LIMITS.compatibility} characters`));
    }
    if (data.metadata !== undefined && (typeof data.metadata !== "object" || data.metadata === null)) {
      errors.push(at("metadata must be a map of strings"));
    }

    const lines = source.split("\n").length;
    if (lines >= LIMITS.lines) errors.push(at(`SKILL.md is ${lines} lines; the spec asks for under ${LIMITS.lines}`));
    else if (lines > LIMITS.softLines) warnings.push(at(`SKILL.md is ${lines} lines; move detail into references/`));

    // Every link must resolve inside the skill: an installed skill is the
    // directory alone, so a link to a sibling skill or the repo is a dead link.
    const docs = [skillPath, ...listFiles(join(dir, "references")).filter((f) => f.endsWith(".md"))];
    for (const doc of docs) {
      for (const target of relativeLinks(readFileSync(doc, "utf8"))) {
        const abs = resolve(dirname(doc), decodeURIComponent(target));
        const where = relative(root, doc);
        if (!abs.startsWith(dir + sep)) errors.push(`${where}: link "${target}" leaves the skill directory`);
        else if (!existsSync(abs)) errors.push(`${where}: link "${target}" does not resolve`);
      }
    }

    const launcher = join(dir, "scripts", "asc.mjs");
    if (!existsSync(launcher)) errors.push(at("scripts/asc.mjs is missing (run npm run manifests:sync)"));
    else if (canonical !== null && readFileSync(launcher, "utf8") !== canonical) {
      errors.push(at("scripts/asc.mjs differs from scripts/skill-launcher.mjs (run npm run manifests:sync)"));
    }
  }
  return { skills, errors, warnings };
}

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { skills, errors, warnings } = checkSkills();
  for (const w of warnings) console.error(`! ${w}`);
  if (errors.length) {
    console.error("✗ skill checks failed:");
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.error(`✓ ${skills.length} skills: ${skills.join(", ")}`);
}
