// Structured logging + a collectible result report. Single responsibility:
// present progress to a human AND accumulate a machine-readable summary so an
// agent can reason about what happened without scraping stdout.

/** Command outcome statuses. */
export const Status = Object.freeze({
  OK: "ok", // already correct, nothing to do
  CHANGED: "changed", // we mutated ASC to make it correct
  SKIPPED: "skipped", // not applicable (e.g. no subscription configured)
  MANUAL: "manual", // requires a human in the ASC web UI (Apple has no API)
  ERROR: "error", // failed
});

const ICON = { ok: "✓", changed: "✓", skipped: "·", manual: "⚠", error: "✗" };

export function createLogger({ stream = process.stdout } = {}) {
  const results = [];
  const write = (s) => stream.write(s + "\n");

  return {
    section(title) {
      write(`\n${title}`);
      write("─".repeat(58));
    },
    info: (m) => write(`  ${m}`),
    warn: (m) => write(`  ⚠ ${m}`),

    /** Record and print a command result. */
    result({ id, title, status, message = "" }) {
      results.push({ id, title, status, message });
      write(`${ICON[status] || "•"} ${title}${message ? " — " + message : ""}`);
    },

    /** Machine-readable summary of every recorded result. */
    summary: () => results.slice(),

    /** True if any result was an error. */
    hasErrors: () => results.some((r) => r.status === Status.ERROR),

    /** Results that still need a human in the ASC UI. */
    manualSteps: () => results.filter((r) => r.status === Status.MANUAL),
  };
}
