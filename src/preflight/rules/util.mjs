// Helpers every rule shares: building an app finding, and finding where in the
// source something appears, so a finding can point at file and line.

import { finding, Category, FixOwner, Severity } from "../../core/findings.mjs";

export { Severity };

/**
 * @param {Partial<import("../../core/findings.mjs").Finding> & { id: string, title: string, guideline?: string }} f
 */
export const appFinding = (f) =>
  finding({ category: Category.APP, fixOwner: FixOwner.EXTERNAL, docs: "app-store-preflight", ...f });

/**
 * First place a pattern appears in the source, as { file, line }.
 * @param {import("../project.mjs").Project} project
 * @param {RegExp} pattern
 */
export function locate(project, pattern) {
  for (const { file, text } of project.sources) {
    const m = pattern.exec(text);
    if (m) return { file, line: text.slice(0, m.index).split("\n").length };
  }
  return null;
}

/** True when any listed package is a dependency. @param {import("../project.mjs").Project} project @param {string[]} names */
export const hasAny = (project, names) => names.some((n) => project.deps.has(n));
