// The one question this tool asks git: will this file stay out of a commit?

import { execFileSync } from "node:child_process";

/**
 * Ask git, rather than reimplementing .gitignore semantics. False when git is
 * missing or the path is not in a repository: nothing then keeps it out.
 *
 * @param {string} path
 * @param {string} cwd
 */
export function isGitIgnored(path, cwd) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
