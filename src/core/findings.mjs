// A Finding is the one thing this tool produces that a raw App Store Connect API
// wrapper cannot: not "here is the state", but "here is what is wrong, who can fix
// it, and how". Every surface — CLI text, --json, MCP structuredContent — renders
// the same objects.
//
// The catalog of checks that *produce* findings lives in src/report/checks/.
// This module only defines their shape, so core/ can raise them too.

/** How badly a finding matters. */
export const Severity = Object.freeze({
  BLOCKER: "blocker", // submission cannot succeed until this is resolved
  WARNING: "warning", // will likely cause a rejection or a surprise
  INFO: "info", // worth knowing, not in the way
});

/** Which broad part of the world the finding is about. */
export const Category = Object.freeze({
  CONFIG: "config", // the user's config file
  ASSET: "asset", // a local file: screenshot, icon, review image
  ASC_STATE: "asc-state", // what App Store Connect currently holds
  BINARY: "binary", // the uploaded build itself
  ACCOUNT: "account", // API key, roles, agreements
});

/** Who is able to resolve it. */
export const FixOwner = Object.freeze({
  CLI: "cli", // this tool can do it — `fixCommand` says how
  UI: "ui", // a human in App Store Connect — `fixClicks` says where
  EXTERNAL: "external", // somewhere else entirely (Xcode, EAS, the binary)
});

/**
 * @typedef {Object} Finding
 * @property {string} id                stable dotted identifier, e.g. "version.build.missing"
 * @property {typeof Severity[keyof typeof Severity]} severity
 * @property {typeof Category[keyof typeof Category]} category
 * @property {string} title             one line, no trailing punctuation
 * @property {string} detail            what is wrong, including the observed value
 * @property {typeof FixOwner[keyof typeof FixOwner]} fixOwner
 * @property {string} fix               imperative instruction
 * @property {string} [fixCommand]      e.g. "appstore-release attach-build"
 * @property {string[]} [fixClicks]     ordered App Store Connect UI path
 * @property {boolean} uiOnly           Apple exposes no API for this, ever
 * @property {string} [docs]            anchor into references/gotchas.md
 * @property {object} [evidence]        { expected, actual, resource, id }
 * @property {boolean} blocksSubmission
 */

/**
 * Build a Finding, filling in the parts that are derivable so call sites stay short.
 *
 * `uiOnly` and `fixOwner` are deliberately separate and must never be conflated:
 * `uiOnly: true` means no amount of API work will ever fix this, while
 * `fixOwner: "ui"` with `uiOnly: false` means we could automate it and have not.
 * Marking our own gaps as Apple's limitations would be the one lie this tool
 * cannot afford.
 *
 * @param {Partial<Finding> & Pick<Finding, "id" | "title">} f
 * @returns {Finding}
 */
export function finding(f) {
  const severity = f.severity ?? Severity.BLOCKER;
  const fixOwner = f.fixOwner ?? FixOwner.CLI;
  return {
    category: Category.ASC_STATE,
    detail: "",
    fix: "",
    ...f,
    severity,
    fixOwner,
    // Derived last: only a human in App Store Connect can own a UI-only finding.
    uiOnly: fixOwner === FixOwner.UI && (f.uiOnly ?? false),
    blocksSubmission: f.blocksSubmission ?? severity === Severity.BLOCKER,
  };
}

/** @param {Finding[]} findings */
export const blockers = (findings) => findings.filter((f) => f.severity === Severity.BLOCKER);

/** @param {Finding[]} findings */
export const uiOnly = (findings) => findings.filter((f) => f.uiOnly);

/** Findings this tool can still act on itself. @param {Finding[]} findings */
export const actionable = (findings) => findings.filter((f) => !f.uiOnly && f.severity === Severity.BLOCKER);
