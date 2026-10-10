// Three renderings of one object: terminal text, markdown for a model, and the
// raw object for --json and MCP structuredContent. Computed once, shown three
// ways — so the CLI and an agent can never disagree about what is wrong.

import { versionState } from "../core/status.mjs";
import { Severity } from "../core/findings.mjs";
import { PIPELINE } from "../ops/registry.mjs";
import { PLAIN } from "../cli/style.mjs";

const VERDICT_LINE = {
  ready: "READY — nothing is blocking submission",
  blocked: "BLOCKED — there is still work this tool can do",
  "needs-human": "NEEDS YOU — only App Store Connect's UI can finish these",
  "in-review": "IN REVIEW — submitted, waiting on Apple",
  approved: "APPROVED — waiting for you to release it",
  rejected: "REJECTED — Apple sent it back",
  live: "LIVE — no version is open for editing",
};

/** The verdict as one word and a colour, for the headline. */
const HEADLINE = {
  ready: ["✓", "READY", "green"],
  blocked: ["✗", "BLOCKED", "red"],
  "needs-human": ["!", "NEEDS YOU", "yellow"],
  "in-review": ["◷", "IN REVIEW", "cyan"],
  approved: ["✓", "APPROVED", "green"],
  rejected: ["✗", "REJECTED", "red"],
  live: ["●", "LIVE", "green"],
};

/**
 * Terminal text, readable at a glance: a headline, one line per section, and
 * what to type next. When the listing pipeline would fix everything that is
 * wrong, the plan is a single `release` rather than eight commands that each
 * fix one thing. Details live in --json and the markdown rendering.
 *
 * @param {import("./report.mjs").ReadinessReport} report
 * @param {{ style?: import("../cli/style.mjs").Style, compact?: boolean }} [options]
 * @returns {string}
 */
export function renderReportText(report, { style = PLAIN, compact = false } = {}) {
  const s = style;
  const lines = [];
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  const blocking = report.findings.filter((f) => f.severity === Severity.BLOCKER);
  const fixable = blocking.filter((f) => !f.uiOnly);
  const human = blocking.filter((f) => f.uiOnly);

  const app = report.app?.name ?? "app";
  const version = report.version ? `${report.version.versionString} · ${report.version.state}` : "no editable version";
  const [icon, word, colour] = HEADLINE[report.verdict] ?? ["·", report.verdict, "bold"];
  const paint = /** @type {(t: string) => string} */ (s[/** @type {keyof typeof s} */ (colour)] ?? s.bold);

  // Compact follows a release, which has just shown what it touched; the app and
  // version are already on screen.
  lines.push("");
  if (!compact) lines.push(`${s.bold(app)} ${s.dim(version)}`, "");
  lines.push(`${paint(s.bold(`${icon} ${word}`))}  ${summaryLine(report.verdict, fixable.length, human.length)}`);

  // Sections: compact mode only lists the ones with something wrong.
  const sections = compact ? report.sections.filter((x) => x.state !== "ok") : report.sections;
  if (sections.length) {
    lines.push("");
    const width = Math.max(...sections.map((x) => x.title.length));
    for (const section of sections) {
      const wrong = section.findingIds.map((id) => byId.get(id)).filter((f) => f && f.severity !== Severity.INFO);
      const mark = section.state === "ok" ? s.green("✓") : section.state === "incomplete" ? s.yellow("·") : s.red("✗");
      const first = wrong[0] ? clip(/** @type {any} */ (wrong[0]).title, 44) : "";
      const more = wrong.length > 1 ? s.dim(` +${wrong.length - 1}`) : "";
      lines.push(`  ${mark} ${section.title.padEnd(width)}   ${s.dim(first)}${more}`.trimEnd());
    }
  }

  const plan = planLines(report, fixable, s);
  if (plan.length) lines.push("", ...plan);

  const warnings = report.findings.filter((f) => f.severity === Severity.WARNING);
  if (warnings.length && !compact) {
    lines.push("", s.yellow(`Warnings (${warnings.length})`));
    for (const f of warnings) lines.push(`  ${s.yellow("·")} ${f.title}`);
  }
  if (report.errors.length) {
    lines.push("", s.red("Could not read"), ...report.errors.map((e) => `  ${e}`));
  }
  return lines.join("\n");
}

/** @param {string} verdict @param {number} fixable @param {number} human */
function summaryLine(verdict, fixable, human) {
  const things = (/** @type {number} */ n) => `${n} thing${n === 1 ? "" : "s"}`;
  switch (verdict) {
    case "ready":
      return "nothing is blocking submission";
    case "blocked":
      return human
        ? `${things(fixable + human)} in the way · ${fixable} fixable here, ${human} need you`
        : `${things(fixable)} in the way · all fixable here`;
    case "needs-human":
      return `only you can finish ${human === 1 ? "this" : `these ${human}`}, in App Store Connect`;
    case "in-review":
      return "submitted, waiting on Apple";
    case "approved":
      return "Apple approved it · release it when you are ready";
    case "rejected":
      return "Apple sent it back · read Resolution Center";
    case "live":
      return "no version is open for editing";
    default:
      return "";
  }
}

/**
 * "Next": one `release` when the pipeline covers every fixable finding,
 * otherwise each command; then what only a person can do; then submit.
 *
 * @param {import("./report.mjs").ReadinessReport} report
 * @param {import("../core/findings.mjs").Finding[]} fixable
 * @param {import("../cli/style.mjs").Style} s
 */
function planLines(report, fixable, s) {
  const run = report.nextActions.filter((a) => a.kind === "run" && a.command);
  const human = report.nextActions.filter((a) => a.kind === "human");
  const wait = report.nextActions.find((a) => a.kind === "wait");
  const steps = [];

  const pipelineOnly =
    run.length > 1 && run.every((a) => PIPELINE.includes(String(a.command).replace(/^appstore-release /, "")));
  if (pipelineOnly) {
    steps.push([`$ appstore-release release`, `fixes all ${fixable.length}`]);
  } else {
    for (const a of run) steps.push([`$ ${a.command}`, `${a.findingIds.length} to fix`]);
  }
  for (const a of human) steps.push([`you: ${a.label}`, a.clicks?.join(" → ") ?? ""]);
  if (report.verdict === "ready") steps.push([`$ appstore-release submit --submit`, "send it to App Review"]);
  if (wait && !steps.length) return [`${s.dim("Next")}  nothing to do but wait`];
  if (!steps.length) return [];

  const width = Math.max(...steps.map(([cmd]) => cmd.length));
  return steps.map(([cmd, why], i) => {
    const label = i === 0 ? s.dim("Next") : "    ";
    const n = steps.length > 1 ? `${i + 1}. ` : "";
    return `${label}  ${n}${s.cyan(cmd.padEnd(width))}   ${s.dim(why)}`.trimEnd();
  });
}

/** @param {string} text @param {number} max */
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Markdown for a model. Deliberately not raw JSON: language models follow a
 * numbered list and a small table far more reliably than a nested object, and it
 * costs a fraction of the tokens.
 *
 * @param {import("./report.mjs").ReadinessReport} report
 * @returns {string}
 */
export function renderReportMarkdown(report) {
  const out = [];
  const v = report.version ? `v${report.version.versionString} (${report.version.state})` : "no editable version";

  out.push(`# Readiness: ${report.app?.name ?? "app"} — ${v}`);
  out.push("");
  out.push(`**Verdict: ${report.verdict}** — ${VERDICT_LINE[report.verdict] ?? ""}`);
  out.push(
    `${report.summary.blockers} blocking · ${report.summary.warnings} warnings · ` +
      `${report.summary.uiOnly} that only a human can resolve`,
  );

  const blocking = report.findings.filter((f) => f.severity === Severity.BLOCKER);
  if (blocking.length) {
    out.push("", "## Blocking", "", "| what | who fixes it | how |", "| --- | --- | --- |");
    for (const f of blocking) {
      const who = f.uiOnly ? "you (no API exists)" : "this tool";
      const how = f.fixCommand ? `\`${f.fixCommand}\`` : f.fixClicks?.length ? f.fixClicks.join(" → ") : f.fix;
      out.push(`| ${f.title} | ${who} | ${how} |`);
    }
  }

  const warnings = report.findings.filter((f) => f.severity === Severity.WARNING);
  if (warnings.length) {
    out.push("", "## Warnings", "");
    for (const f of warnings) out.push(`- **${f.title}** — ${f.detail} _${f.fix}_`);
  }

  if (report.nextActions.length) {
    out.push("", "## Do this next, in order", "");
    for (const a of report.nextActions) {
      const suffix = a.command ? ` — \`${a.command}\`` : a.clicks?.length ? ` — ${a.clicks.join(" → ")}` : "";
      out.push(`${a.order}. ${a.label}${suffix}`);
    }
  }

  if (report.errors.length) {
    out.push("", "## Could not read", "", ...report.errors.map((e) => `- ${e}`));
  }

  return out.join("\n");
}

/**
 * The inventory, as text. Used by `status`.
 * @param {import("./snapshot.mjs").AppSnapshot} s
 */
export function renderSnapshotText(s) {
  const lines = [];
  const rule = "─".repeat(58);
  const push = (title, rows) => {
    lines.push("", title, rule);
    lines.push(...(rows.length ? rows : ["  (none)"]));
  };

  if (s.app) {
    lines.push(
      `\n${s.app.attributes.name} · ${s.app.attributes.bundleId} · SKU ${s.app.attributes.sku} · ${s.app.attributes.primaryLocale}`,
      `content rights: ${s.app.attributes.contentRightsDeclaration || "not set"}`,
    );
  }

  push(
    "Versions",
    (s.versions ?? []).map(
      (v) =>
        `  v${v.attributes.versionString} · ${versionState(v)}` +
        ` · copyright:${v.attributes.copyright ? "yes" : "no"}` +
        (v.id === s.version?.id ? "  ← editable" : ""),
    ),
  );

  push(
    "Builds",
    (s.latestBuilds ?? [])
      .slice(0, 6)
      .map(
        (b) =>
          `  ${b.attributes.version} · ${b.attributes.processingState}` +
          `${b.attributes.expired ? " · EXPIRED" : ""} · ${b.attributes.uploadedDate?.slice(0, 10) ?? "?"}` +
          (b.id === s.build?.id ? "  ← attached" : ""),
      ),
  );

  push(
    "Screenshots",
    s.screenshotSets.map(
      (set) =>
        `  ${set.locale} · ${set.displayType} · ${set.screenshots.length} · ` +
        `${set.screenshots.filter((x) => x.state === "COMPLETE").length} complete`,
    ),
  );

  push(
    "Subscriptions",
    s.subscriptions.map((sub) => `  ${sub.name} · ${sub.productId} · ${sub.state}`),
  );

  lines.push("", "Pricing", rule, `  price schedule: ${s.pricing.hasSchedule ? "set" : "NOT SET"}`);

  if (s.errors.length)
    push(
      "Could not read",
      s.errors.map((e) => `  ${e}`),
    );

  return lines.join("\n");
}
