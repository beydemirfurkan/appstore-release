// Everything the tool wants to say goes through here as a structured event.
// Nothing in core/ or ops/ writes to a stream: the CLI attaches a text renderer,
// the MCP server attaches nothing and reads the recorded results instead. That
// separation is what makes `--json` a clean stream and the library silent.

import { Status } from "./status.mjs";

export const EventType = Object.freeze({
  SECTION: "section", // a heading in human output
  INFO: "info",
  WARN: "warn",
  RESULT: "result", // an operation finished
  REQUEST: "request", // an HTTP call completed (verbose/telemetry)
  CHANGE: "change", // a mutation was applied, or planned under dry run
});

/**
 * @typedef {Object} OperationResult
 * @property {string} id
 * @property {string} title
 * @property {import("./status.mjs").StatusValue} status
 * @property {string} message
 * @property {object} [details]                              operation-specific structured payload
 * @property {import("./findings.mjs").Finding[]} findings
 * @property {Change[]} changes
 * @property {number} [durationMs]
 * @property {number} [requestCount]
 */

/**
 * @typedef {Object} Change
 * @property {string} resource                                            ASC resource type
 * @property {string} [id]
 * @property {"create"|"update"|"delete"|"upload"|"order"} action
 * @property {any} [before]
 * @property {any} [after]
 * @property {boolean} applied                                            false under dry run
 */

/**
 * @param {{ onEvent?: ((e: any) => void) | null }} [opts]
 */
export function createLog({ onEvent = null } = {}) {
  /** @type {OperationResult[]} */
  const results = [];
  /** @type {Change[]} */
  const changes = [];

  const emit = (event) => {
    if (!onEvent) return;
    // A broken sink must never take down a release that is otherwise fine.
    try {
      onEvent(event);
    } catch {
      /* ignore */
    }
  };

  return {
    /** @param {string} title */
    section: (title) => emit({ type: EventType.SECTION, title }),
    /** @param {string} message */
    info: (message) => emit({ type: EventType.INFO, message }),
    /** @param {string} message */
    warn: (message) => emit({ type: EventType.WARN, message }),

    /** @param {Partial<OperationResult> & {id: string, title: string, status: any}} r */
    result(r) {
      const full = { message: "", findings: [], changes: [], ...r };
      results.push(full);
      emit({ type: EventType.RESULT, result: full });
      return full;
    },

    /** @param {Change} change */
    change(change) {
      changes.push(change);
      emit({ type: EventType.CHANGE, change });
    },

    /** @param {{method: string, path: string, status: number, durationMs: number, attempt: number}} info */
    request: (info) => emit({ type: EventType.REQUEST, ...info }),

    results: () => results.slice(),
    changes: () => changes.slice(),
    hasErrors: () => results.some((r) => r.status === Status.ERROR),
    manualSteps: () => results.filter((r) => r.status === Status.MANUAL),
  };
}

/** @typedef {ReturnType<typeof createLog>} Log */
