// The two vocabularies every surface shares: how an operation ended, and how the
// process ends. Kept dependency-free so anything may import them.

/** Operation outcome statuses. */
export const Status = Object.freeze({
  OK: "ok", // already correct, nothing to do
  CHANGED: "changed", // we mutated ASC to make it correct
  PLANNED: "planned", // dry run: we would have mutated ASC
  SKIPPED: "skipped", // not applicable (e.g. no subscription configured)
  MANUAL: "manual", // requires a human in the ASC web UI (Apple has no API)
  ERROR: "error", // failed
});

/** @typedef {typeof Status[keyof typeof Status]} StatusValue */

/**
 * Process exit codes. The point of the spread is that a caller can tell "you
 * still have work to do" (4) from "only a human can finish this" (5) without
 * parsing output — which is what makes `check && submit` a safe CI one-liner.
 */
export const Exit = Object.freeze({
  OK: 0,
  INTERNAL: 1, // unexpected error — a bug in this tool
  USAGE: 2, // unknown command or bad flag
  CONFIG: 3, // missing/invalid credentials or config
  BLOCKED: 4, // an operation errored, or blockers remain that we could fix
  NEEDS_HUMAN: 5, // nothing left we can fix; UI-only steps remain
  API: 6, // App Store Connect refused us, after retries
  CONFIRM: 7, // destructive operation refused for want of confirmation
});
