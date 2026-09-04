// Public library API. Everything the CLI and the MCP server do, they do through
// these four functions — so the two surfaces cannot drift apart in behaviour.

import { OPERATIONS, PIPELINE, getOperation, operationIds } from "./ops/registry.mjs";
import { validateConfig } from "./core/requirements.mjs";
import { Status } from "./core/status.mjs";
import { AscApiError } from "./asc/client.mjs";

export { createContext, isUsable } from "./core/context.mjs";
export { resolveCredentials, CredentialsError } from "./core/credentials.mjs";
export { loadConfig, findConfigPath, ConfigError, CONFIG_CANDIDATES } from "./core/config.mjs";
export { validateConfig, REQUIREMENTS, requirementsFor, CONFIG_SCHEMA } from "./core/requirements.mjs";
export { finding, Severity, Category, FixOwner, blockers, uiOnly, actionable } from "./core/findings.mjs";
export { Status, Exit } from "./core/status.mjs";
export { EventType } from "./core/events.mjs";
export { AscApiError, AscClient } from "./asc/client.mjs";
export { PIPELINE } from "./ops/registry.mjs";
export { getAppSnapshot } from "./report/snapshot.mjs";
export { getReadinessReport, buildReport } from "./report/report.mjs";
export { renderReportText, renderReportMarkdown } from "./report/render.mjs";

/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : String(e));

/** Describe every operation, for help screens and MCP tool definitions. */
export function listOperations() {
  return operationIds().map((id) => ({ ...OPERATIONS[id].meta }));
}

/**
 * Run one operation. Validates the config it declares it needs *before* touching
 * the network, so a missing field is reported as "config.metadata.keywords is
 * required" rather than as a 409 from Apple three calls later.
 *
 * Never throws for an operation failure — the result carries the error, so a
 * pipeline keeps going and the caller sees everything that is wrong at once.
 *
 * @param {string} id
 * @param {import("./core/context.mjs").Context} ctx
 * @param {Record<string, any>} [args]
 * @returns {Promise<import("./core/events.mjs").OperationResult>}
 */
export async function runOperation(id, ctx, args = {}) {
  const op = getOperation(id);
  if (!op) throw new Error(`Unknown operation: ${id}. Known: ${operationIds().join(", ")}`);

  const started = Date.now();
  const requestsBefore = ctx.client.requestCount;
  const base = { id: op.meta.id, title: op.meta.title };

  const { findings } = validateConfig(ctx.config, { needs: op.meta.needs ?? [] });
  const missing = findings.filter((f) => f.severity === "blocker");
  if (missing.length) {
    return ctx.log.result({
      ...base,
      status: Status.ERROR,
      message: missing.map((f) => f.title).join("; "),
      findings,
      changes: [],
      durationMs: Date.now() - started,
      requestCount: 0,
    });
  }

  const argsWithDefaults = withDefaults(op.meta, args);

  try {
    const res = await op.run(ctx, argsWithDefaults);
    // Under dry run an operation that reports CHANGED did not actually change
    // anything, so say so rather than claiming a mutation that never happened.
    const status = ctx.dryRun && res.status === Status.CHANGED ? Status.PLANNED : res.status;
    return ctx.log.result({
      ...base,
      ...res,
      status,
      findings: [...findings, ...(res.findings ?? [])],
      changes: res.changes ?? [],
      durationMs: Date.now() - started,
      requestCount: ctx.client.requestCount - requestsBefore,
    });
  } catch (e) {
    return ctx.log.result({
      ...base,
      status: Status.ERROR,
      message: messageOf(e),
      findings: [...findings, ...(e instanceof AscApiError ? e.hints : [])],
      changes: [],
      durationMs: Date.now() - started,
      requestCount: ctx.client.requestCount - requestsBefore,
    });
  }
}

/**
 * Run several operations in order. Fails soft by default: one broken step should
 * not hide what the remaining eight would have told you.
 *
 * @param {readonly string[]} ids
 * @param {import("./core/context.mjs").Context} ctx
 * @param {{ stopOnError?: boolean, args?: Record<string, any> }} [opts]
 */
export async function runPipeline(ids = PIPELINE, ctx, { stopOnError = false, args = {} } = {}) {
  const results = [];
  for (const id of ids) {
    const res = await runOperation(id, ctx, args[id] ?? {});
    results.push(res);
    if (stopOnError && res.status === Status.ERROR) break;
  }
  return { results, changes: ctx.log.changes() };
}

/** Apply the declared defaults from `meta.args` to what the caller passed. */
function withDefaults(meta, args) {
  const out = { ...args };
  for (const [name, spec] of Object.entries(meta.args ?? {})) {
    if (out[name] === undefined && spec.default !== undefined) out[name] = spec.default;
  }
  return out;
}
