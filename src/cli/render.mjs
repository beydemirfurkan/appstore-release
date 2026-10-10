// Human-readable rendering. The only place in the codebase that formats for a
// terminal, and the only place that writes to a stream — everything upstream
// emits structured events.

import { EventType } from "../core/events.mjs";
import { Status } from "../core/status.mjs";
import { Severity, FixOwner } from "../core/findings.mjs";
import { PLAIN } from "./style.mjs";
import { renderReportText } from "../report/render.mjs";

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
 * Results are one aligned line each — what ran, then what happened, dimmed and
 * clipped to the terminal — so a ten-step release reads as a column of ticks.
 *
 * @param {{ write: (s: string) => any, columns?: number }} stream
 * @param {{ verbose?: boolean, quiet?: boolean, style?: import("./style.mjs").Style }} [opts]
 */
export function createTextSink(stream, { verbose = false, quiet = false, style = PLAIN } = {}) {
  const s = style;
  const write = (/** @type {string} */ line) => stream.write(line + "\n");
  const width = stream.columns && stream.columns > 40 ? stream.columns : 100;
  const paint = {
    [Status.OK]: s.green,
    [Status.CHANGED]: s.green,
    [Status.PLANNED]: s.cyan,
    [Status.SKIPPED]: s.dim,
    [Status.MANUAL]: s.yellow,
    [Status.ERROR]: s.red,
  };
  return (event) => {
    switch (event.type) {
      case EventType.SECTION:
        if (!quiet) write(`\n${s.bold(event.title)}`);
        break;
      case EventType.INFO:
        if (!quiet) write(`  ${event.message}`);
        break;
      case EventType.WARN:
        write(`  ${s.yellow("⚠")} ${event.message}`);
        break;
      case EventType.REPORT:
        if (!quiet) write(renderReportText(event.report, { style: s, compact: event.compact }));
        break;
      case EventType.RESULT: {
        const { id, status, title, message } = event.result;
        // The readiness report has just printed itself, verdict first; a status
        // line after it ("✓ … blocked") would only contradict it.
        if (id === "check" && !quiet) break;
        // A step with nothing configured has nothing to say, unless asked.
        if (status === Status.SKIPPED && !verbose) break;
        const icon = (paint[status] ?? s.dim)(ICON[status] ?? "•");
        const name = title.padEnd(TITLE_WIDTH);
        const room = Math.max(20, width - TITLE_WIDTH - 6);
        const text = message.length > room ? `${message.slice(0, room - 1)}…` : message;
        write(`${icon} ${name}  ${status === Status.ERROR ? s.red(text) : s.dim(text)}`.trimEnd());
        break;
      }
      case EventType.CHANGE:
        if (verbose)
          write(`    ${event.change.applied ? "applied" : "would"} ${event.change.action} ${event.change.resource}`);
        break;
      case EventType.REQUEST:
        if (verbose) {
          const retry = event.attempt > 1 ? ` (attempt ${event.attempt})` : "";
          write(s.dim(`    → ${event.method} ${event.path} ${event.status} ${event.durationMs}ms${retry}`));
        }
        break;
    }
  };
}

/** Wide enough for the longest operation title ("Pricing + copyright"). */
const TITLE_WIDTH = 20;

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
