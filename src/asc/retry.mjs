// Retry policy for App Store Connect. The interesting rule is the one about
// POST: a 429 means Apple never processed the request, so re-sending is safe,
// but a connection dropped mid-flight might have created a certificate or a
// review submission. Those are not safe to repeat, so we do not.

export const RETRY_DEFAULTS = Object.freeze({
  attempts: 4,
  baseMs: 500,
  capMs: 8000,
});

const IDEMPOTENT = new Set(["GET", "HEAD", "PATCH", "DELETE", "PUT"]);
/** Failures that prove the request never reached Apple. */
const PRE_CONNECTION = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET"]);

/**
 * @param {{ method: string, status?: number, error?: any, attempt: number, attempts: number }} ctx
 * @returns {boolean}
 */
export function shouldRetry({ method, status, error, attempt, attempts }) {
  if (attempt >= attempts) return false;

  if (status === 429) return true; // rate limited: not processed, safe for any method
  if (status && status >= 500 && status < 600) return IDEMPOTENT.has(method);

  if (error) {
    const code = error.code ?? error.cause?.code;
    // A pre-connection failure is safe for anything; anything else, only if the
    // method is one we can repeat without creating a second resource.
    if (code && PRE_CONNECTION.has(code)) return code === "ECONNRESET" ? IDEMPOTENT.has(method) : true;
    if (error.name === "TimeoutError" || error.name === "AbortError") return IDEMPOTENT.has(method);
    return false;
  }

  return false;
}

/**
 * Full-jitter exponential backoff. Jitter matters more than the exponent: without
 * it every request in a pipeline that hits the same 429 retries in lockstep.
 *
 * @param {number} attempt                1-based
 * @param {{baseMs?: number, capMs?: number}} [opts]
 * @param {() => number} [random]
 */
export function backoffMs(
  attempt,
  { baseMs = RETRY_DEFAULTS.baseMs, capMs = RETRY_DEFAULTS.capMs } = {},
  random = Math.random,
) {
  const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

/**
 * Apple's Retry-After, when present, overrides our own backoff — it is the only
 * party that knows how long the rate limit actually lasts.
 *
 * @param {Headers|undefined} headers
 * @returns {number|null} milliseconds
 */
export function retryAfterMs(headers) {
  const raw = headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
