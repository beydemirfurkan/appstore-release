// Relative paths in a config mean "relative to the config", never "relative to
// wherever the process happened to start". Getting this wrong is what made an
// installed plugin resolve `./assets/screenshots` inside its own install
// directory and write credentials.json into the plugin tree.

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve, relative, dirname, join, parse } from "node:path";

export class PathError extends Error {}

/**
 * Resolve a config-relative path against the project root, refusing anything
 * that escapes it. The escape check is what lets the MCP server accept a path
 * from a model without handing it the whole filesystem.
 *
 * Symlinks are resolved before comparing, so a link inside the root that points
 * outside it is still rejected. A path that does not exist yet is checked
 * against its nearest existing ancestor, because we also resolve write targets.
 *
 * @param {string} projectRoot  absolute directory every relative path hangs off
 * @param {string} p            the path from config or a tool argument
 * @param {{ purpose?: string, allowOutside?: boolean, boundary?: string }} [opts]
 *   `boundary`: the directory paths must stay inside, when wider than the root —
 *   the enclosing repository (see `repositoryBoundary`). Relative paths still
 *   hang off `projectRoot`.
 * @returns {string} absolute path
 */
export function resolveProjectPath(projectRoot, p, { purpose, allowOutside = false, boundary } = {}) {
  if (typeof p !== "string" || p === "") {
    throw new PathError(`${purpose ?? "path"} is empty`);
  }
  // Resolve against the root as the caller spelled it, so the paths we hand back
  // and print look like the ones they typed. Containment, though, is judged on
  // realpaths — otherwise a symlink out of the tree would pass the check.
  const abs = isAbsolute(p) ? p : resolve(projectRoot, p);
  if (allowOutside) return abs;

  const realRoot = realpathOrSelf(boundary ?? projectRoot);
  const real = nearestRealPath(abs);
  const rel = relative(realRoot, real);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return abs;

  throw new PathError(
    `${purpose ?? "path"} "${p}" resolves to ${real}, outside ${boundary ? "the repository" : "the project root"} ${realRoot}. ` +
      `Pass --project-root if the file really lives elsewhere.`,
  );
}

/**
 * The repository a project lives in, as the outer limit for its paths: a
 * monorepo keeps screenshots in a sibling of the app's folder. Never the home
 * directory or the root of the disk, even when one of them is a repository.
 *
 * @param {string} projectRoot
 * @returns {string} the repository root, or `projectRoot` itself when there is none
 */
export function repositoryBoundary(projectRoot) {
  const home = realpathOrSelf(homedir());
  let dir = realpathOrSelf(projectRoot);
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      return dir === home || dir === parse(dir).root ? projectRoot : dir;
    }
    const up = dirname(dir);
    if (up === dir || dir === home) return projectRoot;
    dir = up;
  }
}

/** realpath, or the input unchanged when it does not exist yet. */
function realpathOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * The realpath of the deepest existing ancestor, with the not-yet-created tail
 * appended — so a write target inside a symlinked directory is judged by where
 * that directory actually is.
 */
function nearestRealPath(abs) {
  let current = resolve(abs);
  const tail = [];
  for (;;) {
    try {
      return tail.length ? resolve(realpathSync(current), ...tail) : realpathSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return abs; // hit the filesystem root; nothing resolvable
      tail.unshift(current.slice(parent.length + 1));
      current = parent;
    }
  }
}
