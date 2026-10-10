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
  WAITING: 8, // `check --wait` ran out of time with the version still in review
});

/**
 * App Store version states, in the two groupings everything else needs. One list,
 * here, because three diverging copies of it is how a version removed from sale
 * came to count as "open for editing".
 */
export const VersionStates = Object.freeze({
  /** States in which the listing can be written. */
  EDITABLE: Object.freeze([
    "PREPARE_FOR_SUBMISSION",
    "DEVELOPER_REJECTED",
    "REJECTED",
    "METADATA_REJECTED",
    "INVALID_BINARY",
  ]),
  /** With Apple, or approved and waiting on the developer: not editable, not yet live. */
  IN_FLIGHT: Object.freeze([
    "READY_FOR_REVIEW",
    "WAITING_FOR_REVIEW",
    "IN_REVIEW",
    "WAITING_FOR_EXPORT_COMPLIANCE",
    "PENDING_DEVELOPER_RELEASE",
    "PENDING_APPLE_RELEASE",
    "ACCEPTED",
    "PROCESSING_FOR_DISTRIBUTION",
  ]),
});

/** Pre-2025 spellings of `appStoreState`, as `appVersionState` names them. */
const LEGACY_VERSION_STATES = Object.freeze({
  READY_FOR_SALE: "READY_FOR_DISTRIBUTION",
  PROCESSING_FOR_APP_STORE: "PROCESSING_FOR_DISTRIBUTION",
});

/**
 * An App Store version's state. Apple deprecated `appStoreState` for
 * `appVersionState`; this reads the new one and falls back to the old, with the
 * old names translated, so every caller sees one vocabulary.
 *
 * @param {{ attributes?: { appVersionState?: string, appStoreState?: string } } | null | undefined} version
 * @returns {string}
 */
export function versionState(version) {
  const a = version?.attributes ?? {};
  if (a.appVersionState) return a.appVersionState;
  const old = a.appStoreState ?? "";
  return /** @type {Record<string,string>} */ (LEGACY_VERSION_STATES)[old] ?? old;
}

/** Approved, and on its way out: with the developer, Apple, or processing. */
export const APPROVED_STATES = Object.freeze([
  "PENDING_DEVELOPER_RELEASE",
  "PENDING_APPLE_RELEASE",
  "ACCEPTED",
  "PROCESSING_FOR_DISTRIBUTION",
]);

/** The version a report or a new-version call is about: editable, else in flight. */
export const isCurrentVersionState = (/** @type {string} */ state) =>
  VersionStates.EDITABLE.includes(state) || VersionStates.IN_FLIGHT.includes(state);

/** App Info states that belong to the live listing; the editable one is preferred over them. */
const LIVE_APP_INFO_STATES = ["READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "REPLACED_WITH_NEW_INFO"];

/**
 * During an update an app has two App Infos, the live one and the one being
 * prepared; writing to the live one is a 409 at best. Apple renamed the state
 * attribute (`appStoreState` → `state`), so both are read.
 *
 * @template {{ attributes?: any }} T
 * @param {T[]} infos
 * @returns {T|null}
 */
export function pickEditableAppInfo(infos) {
  const stateOf = (/** @type {T} */ i) => i.attributes?.state ?? i.attributes?.appStoreState;
  return infos.find((i) => !LIVE_APP_INFO_STATES.includes(stateOf(i))) ?? infos[0] ?? null;
}

/**
 * True when the app has never had another version on this platform. That, and
 * not "1.0" or PREPARE_FOR_SUBMISSION (every unsubmitted update is in that state
 * too), is what Apple means by a first version: the one where whatsNew cannot be
 * set, and the only one where it may be left out.
 *
 * @param {any[]} versions   every appStoreVersion of the app
 * @param {any} version      the one being prepared
 */
export function isFirstVersion(versions, version) {
  if (!version) return false;
  const platform = version.attributes?.platform;
  return !versions.some(
    (v) => v.id !== version.id && (!platform || !v.attributes?.platform || v.attributes.platform === platform),
  );
}
