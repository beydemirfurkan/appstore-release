#!/usr/bin/env node
// appstore-release skill launcher — finds the appstore-release CLI and runs it.
//
// A skill installed with `npx skills add` is a copy of one skills/<name>/
// directory: SKILL.md, references/, scripts/ — and not the CLI it drives. This
// file closes that gap with zero dependencies. It looks for the CLI, in order:
//
//   1. $APPSTORE_RELEASE_HOME          an explicit checkout (wrong path = hard error)
//   2. $CLAUDE_PLUGIN_ROOT             the Claude Code plugin install
//   3. the directories above this one  the skill is being run from a repo clone
//   4. ~/.cache/appstore-release/v<VERSION>, cloned on first use at the tag
//      matching this skill's version, so the instructions and the CLI agree.
//
// `node asc.mjs --which-cli` prints what it resolved and exits.
//
// GENERATED COPY. The source is scripts/skill-launcher.mjs in the repository;
// `npm run manifests:sync` copies it into every skill and stamps VERSION.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VERSION = "4.3.0";
export const REPO = "https://github.com/beydemirfurkan/appstore-release.git";

/** @param {string} dir */
export function isCheckout(dir) {
  try {
    if (!existsSync(join(dir, "src", "cli.mjs"))) return false;
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "appstore-release";
  } catch {
    return false;
  }
}

/** @param {Record<string, string|undefined>} env */
export function cacheRoot(env) {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "appstore-release");
}

/**
 * Resolve without touching the network. Returns null when only a clone would do.
 *
 * @param {{ env?: Record<string, string|undefined>, from?: string }} [opts]
 * @returns {{ root: string, source: string } | null}
 */
export function resolveLocal({ env = process.env, from = dirname(fileURLToPath(import.meta.url)) } = {}) {
  const home = env.APPSTORE_RELEASE_HOME;
  if (home) {
    // Someone set this on purpose. Silently falling through to a different copy
    // would run code they did not choose.
    if (!isCheckout(resolve(home))) {
      throw new Error(`APPSTORE_RELEASE_HOME=${home} is not an appstore-release checkout (no src/cli.mjs)`);
    }
    return { root: resolve(home), source: "APPSTORE_RELEASE_HOME" };
  }

  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot && isCheckout(resolve(pluginRoot))) return { root: resolve(pluginRoot), source: "CLAUDE_PLUGIN_ROOT" };

  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (isCheckout(dir)) return { root: dir, source: "enclosing checkout" };
    if (dirname(dir) === dir) break;
  }

  const pinned = join(cacheRoot(env), `v${VERSION}`);
  if (isCheckout(pinned)) return { root: pinned, source: `cache (v${VERSION})` };
  return null;
}

/**
 * Clone into the cache: the tag for this version, else the default branch.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{ root: string, source: string }}
 */
export function cloneIntoCache(env) {
  const cache = cacheRoot(env);
  mkdirSync(cache, { recursive: true });

  const attempt = (/** @type {string} */ name, /** @type {string[]} */ branchArgs) => {
    const target = join(cache, name);
    const tmp = `${target}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    const r = spawnSync("git", ["clone", "--quiet", "--depth", "1", ...branchArgs, REPO, tmp], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });
    if (r.error) throw new Error(`git is needed to fetch the CLI (${r.error.message}); or set APPSTORE_RELEASE_HOME`);
    if (r.status !== 0 || !isCheckout(tmp)) {
      rmSync(tmp, { recursive: true, force: true });
      return null;
    }
    rmSync(target, { recursive: true, force: true });
    renameSync(tmp, target);
    return target;
  };

  process.stderr.write(`appstore-release: cloning the CLI v${VERSION} into ${cache}\n`);
  const pinned = attempt(`v${VERSION}`, ["--branch", `v${VERSION}`]);
  if (pinned) return { root: pinned, source: `cache (v${VERSION}, just cloned)` };

  process.stderr.write(`appstore-release: tag v${VERSION} not found — using the default branch, unpinned\n`);
  // The tag always gets the first chance, so a release that ships later is
  // picked up; until then an earlier default-branch clone is reused.
  if (isCheckout(join(cache, "head"))) return { root: join(cache, "head"), source: "cache (default branch, unpinned)" };
  const head = attempt("head", []);
  if (head) return { root: head, source: "cache (default branch, unpinned)" };
  throw new Error(`could not clone ${REPO}; clone it yourself and set APPSTORE_RELEASE_HOME`);
}

/** @param {string[]} argv */
export function main(argv) {
  const env = process.env;
  let found;
  try {
    found = resolveLocal({ env }) ?? cloneIntoCache(env);
  } catch (e) {
    process.stderr.write(`appstore-release: ${e instanceof Error ? e.message : String(e)}\n`);
    return 3;
  }

  const cli = join(found.root, "src", "cli.mjs");
  if (argv[0] === "--which-cli") {
    process.stdout.write(`${cli}\t${found.source}\n`);
    return 0;
  }
  const r = spawnSync(process.execPath, [cli, ...argv], { stdio: "inherit" });
  if (r.error) {
    process.stderr.write(`appstore-release: ${r.error.message}\n`);
    return 1;
  }
  return r.status ?? 1;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = main(process.argv.slice(2));
