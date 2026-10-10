// Three renderings of one object: terminal text, markdown for a model, and the
// raw object for --json and MCP structuredContent. Computed once, shown three
// ways — so the CLI and an agent can never disagree about what is wrong.

import { Severity } from "../core/findings.mjs";

const VERDICT_LINE = {
  ready: "READY — nothing is blocking submission",
  blocked: "BLOCKED — there is still work this tool can do",
  "needs-human": "NEEDS YOU — only App Store Connect's UI can finish these",
  "in-review": "IN REVIEW — submitted, waiting on Apple",
  rejected: "REJECTED — Apple sent it back",
  live: "LIVE — no version is open for editing",
};

/**
 * Terminal text. Each fact appears once: a section line names what is wrong
 * there, the plan names the command that fixes it, and only what this tool
 * cannot fix — the steps for a human, and warnings — gets its detail spelled out.
 *
 * @param {import("./report.mjs").ReadinessReport} report
 * @returns {string}
 */
export function renderReportText(report) {
  const lines = [];
  const rule = "─".repeat(58);
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  const titles = (/** @type {string[]} */ ids) =>
    ids
      .map((id) => byId.get(id))
      .filter((f) => f && f.severity !== Severity.INFO)
      .map((f) => f?.title);

  const v = report.version ? `v${report.version.versionString} (${report.version.state})` : "no editable version";
  lines.push(`\nReadiness — ${report.app?.name ?? "app"} · ${v}`, rule);
  lines.push(VERDICT_LINE[report.verdict] ?? report.verdict);

  lines.push("");
  const width = Math.max(...report.sections.map((s) => s.title.length));
  for (const s of report.sections) {
    const icon = s.state === "ok" ? "✓" : s.state === "incomplete" ? "·" : "✗";
    const what = s.state === "ok" ? "" : clip(titles(s.findingIds).join(" · "), 64);
    lines.push(`${icon} ${s.title.padEnd(width)}  ${what}`.trimEnd());
  }

  if (report.nextActions.length) {
    lines.push("", "Next, in order", rule);
    for (const a of report.nextActions) {
      if (a.kind === "run" && a.command) {
        lines.push(`${a.order}. $ ${a.command}`, `     ${clip(titles(a.findingIds).join(" · "), 72)}`);
      } else if (a.kind === "human") {
        lines.push(`${a.order}. [you] ${a.label}`);
        if (a.clicks?.length) lines.push(`     ${a.clicks.join(" → ")}`);
      } else {
        lines.push(`${a.order}. ${a.label}`);
      }
    }
  }

  const warnings = report.findings.filter((f) => f.severity === Severity.WARNING);
  if (warnings.length) {
    lines.push("", `Warnings (${warnings.length})`, rule);
    for (const f of warnings) {
      lines.push(`· ${f.title}`);
      if (f.detail) lines.push(`  ${f.detail}`);
    }
  }

  if (report.errors.length) {
    lines.push("", "Could not read", rule, ...report.errors.map((e) => `  ${e}`));
  }

  return lines.join("\n");
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
        `  v${v.attributes.versionString} · ${v.attributes.appStoreState}` +
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
