// Human-readable rendering. The only place in the codebase that formats for a
// terminal, and the only place that writes to a stream — everything upstream
// emits structured events.

import { EventType } from "../core/events.mjs";
import { Status } from "../core/status.mjs";
import { Severity, FixOwner } from "../core/findings.mjs";

const ICON = {
  [Status.OK]: "✓",
  [Status.CHANGED]: "✓",
  [Status.PLANNED]: "▸",
  [Status.SKIPPED]: "·",
  [Status.MANUAL]: "⚠",
  [Status.ERROR]: "✗",
};

const RULE = "─".repeat(58);

/**
 * An event sink that writes human output to a stream.
 *
 * @param {{ write: (s: string) => any }} stream
 * @param {{ verbose?: boolean, quiet?: boolean }} [opts]
 */
export function createTextSink(stream, { verbose = false, quiet = false } = {}) {
  const write = (s) => stream.write(s + "\n");
  return (event) => {
    switch (event.type) {
      case EventType.SECTION:
        if (!quiet) {
          write(`\n${event.title}`);
          write(RULE);
        }
        break;
      case EventType.INFO:
        if (!quiet) write(`  ${event.message}`);
        break;
      case EventType.WARN:
        write(`  ⚠ ${event.message}`);
        break;
      case EventType.RESULT: {
        const { status, title, message } = event.result;
        write(`${ICON[status] ?? "•"} ${title}${message ? " — " + message : ""}`);
        break;
      }
      case EventType.CHANGE:
        if (verbose)
          write(`    ${event.change.applied ? "applied" : "would"} ${event.change.action} ${event.change.resource}`);
        break;
      case EventType.REQUEST:
        if (verbose) {
          const retry = event.attempt > 1 ? ` (attempt ${event.attempt})` : "";
          write(`    → ${event.method} ${event.path} ${event.status} ${event.durationMs}ms${retry}`);
        }
        break;
    }
  };
}

/**
 * Print the findings that still need someone's attention, cheapest-to-act first:
 * what this tool can fix, then what only a human in App Store Connect can.
 *
 * @param {{ write: (s: string) => any }} stream
 * @param {import("../core/findings.mjs").Finding[]} findings
 */
export function renderFindings(stream, findings) {
  const write = (s) => stream.write(s + "\n");
  const blocking = findings.filter((f) => f.severity === Severity.BLOCKER);
  const warnings = findings.filter((f) => f.severity === Severity.WARNING);
  if (!blocking.length && !warnings.length) return;

  const fixable = blocking.filter((f) => !f.uiOnly);
  const human = blocking.filter((f) => f.uiOnly);

  if (fixable.length) {
    write(`\nBlocking (${fixable.length})`);
    write(RULE);
    fixable.forEach((f, i) => write(formatFinding(f, i + 1)));
  }
  if (human.length) {
    write(`\nOnly you can do these — Apple exposes no API (${human.length})`);
    write(RULE);
    human.forEach((f, i) => write(formatFinding(f, i + 1)));
  }
  if (warnings.length) {
    write(`\nWarnings (${warnings.length})`);
    write(RULE);
    warnings.forEach((f, i) => write(formatFinding(f, i + 1)));
  }
}

/** @param {import("../core/findings.mjs").Finding} f */
function formatFinding(f, n) {
  const lines = [`${n}. ${f.title}`];
  if (f.detail) lines.push(`   ${f.detail}`);
  if (f.fix) lines.push(`   fix: ${f.fix}`);
  if (f.fixCommand) lines.push(`   run: ${f.fixCommand}`);
  if (f.fixOwner === FixOwner.UI && f.fixClicks?.length) {
    lines.push(`   clicks: ${f.fixClicks.join(" → ")}`);
  }
  return lines.join("\n");
}
