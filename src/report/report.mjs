// Turn an inventory into a verdict and an ordered list of what to do next.
//
// `verdict` is the single value an agent branches on; `nextActions` is the
// runbook derived from the findings. No other App Store Connect tool answers
// "what do I do next, in order" — that is the whole point of this module.

import { Severity } from "../core/findings.mjs";
import { getAppSnapshot } from "./snapshot.mjs";

import * as version from "./checks/version.mjs";
import * as metadata from "./checks/metadata.mjs";
import * as screenshots from "./checks/screenshots.mjs";
import * as store from "./checks/store.mjs";
import * as review from "./checks/review.mjs";
import * as subscription from "./checks/subscription.mjs";

/** Order matters: it is the order the sections are reported and acted on. */
export const CHECKS = [version, store, metadata, screenshots, subscription, review];

/**
 * @typedef {"ready"|"blocked"|"needs-human"|"in-review"|"live"|"rejected"} Verdict
 */

/**
 * @typedef {Object} ReadinessReport
 * @property {"1"} schemaVersion
 * @property {string} generatedAt
 * @property {any} app
 * @property {any} version
 * @property {{attached: boolean, version?: string, processingState?: string}} build
 * @property {Array<{id: string, title: string, state: string, findingIds: string[]}>} sections
 * @property {import("../core/findings.mjs").Finding[]} findings
 * @property {{blockers: number, warnings: number, uiOnly: number, checked: number}} summary
 * @property {Verdict} verdict
 * @property {Array<{order: number, kind: "run"|"human"|"wait", label: string, command?: string, clicks?: string[], findingIds: string[]}>} nextActions
 * @property {string[]} errors     sections of App Store Connect we could not read
 */

/**
 * Judge a snapshot. Pure — no network, so it is testable against a fixture.
 *
 * @param {{ snapshot: any, config?: any, resolvePath?: (p: string, purpose?: string) => string }} input
 * @returns {ReadinessReport}
 */
export function buildReport({ snapshot, config = null, resolvePath }) {
  const findings = [];
  const sections = [];

  for (const check of CHECKS) {
    const produced = check.check({ snapshot, config, resolvePath });
    findings.push(...produced);
    const ids = produced.map((f) => f.id);
    sections.push({
      id: check.section.id,
      title: check.section.title,
      state: sectionState(produced),
      findingIds: ids,
    });
  }

  const blockers = findings.filter((f) => f.severity === Severity.BLOCKER);
  const summary = {
    blockers: blockers.length,
    warnings: findings.filter((f) => f.severity === Severity.WARNING).length,
    uiOnly: findings.filter((f) => f.uiOnly).length,
    checked: CHECKS.length,
  };

  return {
    schemaVersion: "1",
    generatedAt: snapshot.generatedAt,
    app: snapshot.app
      ? { id: snapshot.app.id, name: snapshot.app.attributes?.name, bundleId: snapshot.app.attributes?.bundleId }
      : null,
    version: snapshot.version
      ? {
          id: snapshot.version.id,
          versionString: snapshot.version.attributes?.versionString,
          state: snapshot.version.attributes?.appStoreState,
        }
      : null,
    build: {
      attached: Boolean(snapshot.build),
      version: snapshot.build?.attributes?.version,
      processingState: snapshot.build?.attributes?.processingState,
    },
    sections,
    findings,
    summary,
    verdict: verdictFor(snapshot, findings),
    nextActions: nextActions(findings),
    errors: snapshot.errors ?? [],
  };
}

/**
 * Fetch and judge in one call.
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ locale?: string }} [opts]
 * @returns {Promise<ReadinessReport>}
 */
export async function getReadinessReport(ctx, { locale } = {}) {
  const snapshot = await getAppSnapshot(ctx, { locale });
  return buildReport({ snapshot, config: ctx.config, resolvePath: ctx.resolvePath });
}

function sectionState(findings) {
  if (findings.some((f) => f.severity === Severity.BLOCKER)) return "blocked";
  if (findings.some((f) => f.severity === Severity.WARNING)) return "incomplete";
  return "ok";
}

/**
 * The state of the world in one word. "blocked" and "needs-human" are kept apart
 * on purpose: the first means this tool can still do something, the second means
 * only a person in App Store Connect can.
 *
 * @returns {Verdict}
 */
function verdictFor(snapshot, findings) {
  const state = snapshot.version?.attributes?.appStoreState;
  if (["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE"].includes(state)) return "in-review";
  if (["REJECTED", "METADATA_REJECTED"].includes(state)) return "rejected";
  if (!snapshot.version && snapshot.versions?.[0]?.attributes?.appStoreState === "READY_FOR_DISTRIBUTION")
    return "live";

  const blockers = findings.filter((f) => f.severity === Severity.BLOCKER);
  if (blockers.some((f) => !f.uiOnly)) return "blocked";
  if (blockers.length) return "needs-human";
  return "ready";
}

/**
 * Deduplicate findings into an ordered plan: everything this tool can fix,
 * collapsed per command, then the handful only a person can do.
 */
function nextActions(findings) {
  /** @type {ReadinessReport["nextActions"]} */
  const actions = [];
  const byCommand = new Map();

  for (const f of findings) {
    if (f.severity !== Severity.BLOCKER) continue;
    if (f.uiOnly) continue;
    const key = f.fixCommand ?? `fix:${f.id}`;
    if (!byCommand.has(key)) byCommand.set(key, { command: f.fixCommand, label: f.fix || f.title, findingIds: [] });
    byCommand.get(key).findingIds.push(f.id);
  }

  for (const [, entry] of byCommand) {
    actions.push({
      order: actions.length + 1,
      kind: "run",
      label: entry.command ? `Run ${entry.command}` : entry.label,
      command: entry.command,
      findingIds: entry.findingIds,
    });
  }

  for (const f of findings.filter((f) => f.uiOnly && f.severity === Severity.BLOCKER)) {
    actions.push({
      order: actions.length + 1,
      kind: "human",
      label: f.fix || f.title,
      clicks: f.fixClicks,
      findingIds: [f.id],
    });
  }

  const waiting = findings.find((f) => f.id === "submission.in-review");
  if (waiting) {
    actions.push({ order: actions.length + 1, kind: "wait", label: waiting.detail, findingIds: [waiting.id] });
  }

  return actions;
}
