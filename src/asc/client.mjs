// App Store Connect HTTP client. Single responsibility: authenticated requests +
// uniform errors. Knows nothing about specific resources (see discovery.mjs).
//
// Dry run lives here rather than in each operation. An operation that forgets an
// `if (dryRun)` branch would quietly mutate production; a client that refuses
// every non-GET cannot be forgotten, and one test asserts it for all of them.

import { shouldRetry, backoffMs, retryAfterMs, sleep, RETRY_DEFAULTS } from "./retry.mjs";

export const DEFAULT_BASE_URL = "https://api.appstoreconnect.apple.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export class AscApiError extends Error {
  /**
   * @param {number} status
   * @param {string} method
   * @param {string} path
   * @param {Array<{title?: string, detail?: string, code?: string}>} [errors]
   * @param {string} [rawBody]
   */
  constructor(status, method, path, errors, rawBody) {
    const detail = (errors || []).map((e) => `${e.title}${e.detail ? ": " + e.detail : ""}`).join("; ");
    super(`HTTP ${status} ${method} ${path}${detail ? " — " + detail : ""}`);
    this.name = "AscApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.errors = errors || [];
    this.rawBody = rawBody;
    /** @type {import("../core/findings.mjs").Finding[]} filled in by the knowledge base */
    this.hints = [];
  }

  /** The App Store Connect error codes, e.g. ENTITY_ERROR.ATTRIBUTE.INVALID. */
  get codes() {
    return this.errors.map((e) => e.code).filter(Boolean);
  }
}

export class AscClient {
  /**
   * @param {{
   *   tokenProvider: () => string,
   *   fetchImpl?: typeof fetch,
   *   baseUrl?: string,
   *   dryRun?: boolean,
   *   log?: import("../core/events.mjs").Log | null,
   *   retry?: { attempts?: number, baseMs?: number, capMs?: number },
   *   timeoutMs?: number,
   *   random?: () => number,
   * }} deps
   */
  constructor({
    tokenProvider,
    fetchImpl = fetch,
    baseUrl = DEFAULT_BASE_URL,
    dryRun = false,
    log = null,
    retry = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    random = Math.random,
  }) {
    this._token = tokenProvider;
    this._fetch = fetchImpl;
    this._baseUrl = baseUrl;
    this._log = log;
    this._retry = { ...RETRY_DEFAULTS, ...retry };
    this._timeoutMs = timeoutMs;
    this._random = random;
    this.dryRun = dryRun;
    this.requestCount = 0;
    this._dryCounter = 0;
  }

  /**
   * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
   * @param {string} path
   * @param {{ body?: object, throwOnError?: boolean, dryRunResult?: () => any, timeoutMs?: number }} [opts]
   *
   * When throwOnError is false, API errors resolve to `{ error: AscApiError }`
   * instead of throwing — callers must then check `.error` before `.data`.
   */
  async request(method, path, { body, throwOnError = true, dryRunResult, timeoutMs } = {}) {
    if (this.dryRun && method !== "GET") return this._planned(method, path, body, dryRunResult);

    const url = `${this._baseUrl}${path}`;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const started = Date.now();
      let res;
      try {
        res = await this._fetch(url, {
          method,
          headers: { Authorization: `Bearer ${this._token()}`, "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs ?? this._timeoutMs),
        });
      } catch (error) {
        if (shouldRetry({ method, error, attempt, attempts: this._retry.attempts })) {
          await sleep(backoffMs(attempt, this._retry, this._random));
          continue;
        }
        throw error;
      }

      this.requestCount += 1;
      // The Authorization header is never part of the event — these are printed
      // by --verbose and forwarded to MCP hosts.
      this._log?.request({ method, path, status: res.status, durationMs: Date.now() - started, attempt });

      if (!res.ok && shouldRetry({ method, status: res.status, attempt, attempts: this._retry.attempts })) {
        const wait = retryAfterMs(res.headers) ?? backoffMs(attempt, this._retry, this._random);
        await sleep(wait);
        continue;
      }

      return this._parse(res, method, path, throwOnError);
    }
  }

  /** @private */
  async _parse(res, method, path, throwOnError) {
    const text = await res.text();
    let json;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // Apple serves HTML for some 5xx and maintenance windows. Reporting a
        // SyntaxError there tells the user nothing about what went wrong.
        if (res.ok) throw new AscApiError(res.status, method, path, [{ title: "Response was not JSON" }], text);
        json = {};
      }
    } else {
      json = {};
    }

    if (!res.ok) {
      const err = new AscApiError(res.status, method, path, json.errors, text);
      if (throwOnError) throw err;
      return { error: err };
    }
    return json;
  }

  /**
   * Record what would have happened and hand back a response shaped enough for
   * the caller to keep going — every call site reads only `.data.id`.
   * @private
   */
  _planned(method, path, body, dryRunResult) {
    const type = body?.data?.type ?? path.split("?")[0].split("/").filter(Boolean).pop() ?? "unknown";
    const action = method === "POST" ? "create" : method === "DELETE" ? "delete" : "update";
    this._log?.change({ resource: type, action, after: body?.data?.attributes, applied: false });
    if (dryRunResult) return dryRunResult();
    this._dryCounter += 1;
    return { data: { type, id: `dry:${type}:${this._dryCounter}` } };
  }

  get(path, opts) {
    return this.request("GET", path, opts);
  }
  post(path, body, opts) {
    return this.request("POST", path, { ...opts, body });
  }
  patch(path, body, opts) {
    return this.request("PATCH", path, { ...opts, body });
  }
  delete(path, opts) {
    return this.request("DELETE", path, opts);
  }

  /**
   * Walk every page of a collection. Replaces the hardcoded `limit=` values that
   * silently truncated results for apps with many locales or screenshots.
   *
   * @param {string} path
   * @param {{ limit?: number, maxPages?: number }} [opts]
   * @returns {AsyncGenerator<any>}
   */
  async *paginate(path, { limit = 200, maxPages = 50 } = {}) {
    let next = path.includes("limit=") ? path : `${path}${path.includes("?") ? "&" : "?"}limit=${limit}`;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.get(next);
      for (const item of res.data ?? []) yield item;
      const link = res.links?.next;
      if (!link) return;
      next = link.startsWith(this._baseUrl) ? link.slice(this._baseUrl.length) : link;
    }
    this._log?.warn(`stopped paginating ${path} after ${maxPages} pages`);
  }

  /** Collect an entire paginated collection into an array. */
  async all(path, opts) {
    const out = [];
    for await (const item of this.paginate(path, opts)) out.push(item);
    return out;
  }

  /**
   * PUT one chunk to a pre-signed upload URL. Deliberately not `request`: the URL
   * is absolute and already carries its own auth, so sending our bearer token
   * would be both wrong and a credential leak to a third-party host. Everything
   * else — timeout, retry, events, the injectable fetch — still applies, which is
   * what makes the upload path testable at all.
   *
   * @param {{ url: string, method?: string, headers?: Record<string,string>, body: Buffer|Uint8Array }} op
   */
  async uploadChunk({ url, method = "PUT", headers = {}, body }) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const started = Date.now();
      let res;
      try {
        res = await this._fetch(url, { method, headers, body, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
      } catch (error) {
        if (shouldRetry({ method, error, attempt, attempts: this._retry.attempts })) {
          await sleep(backoffMs(attempt, this._retry, this._random));
          continue;
        }
        throw error;
      }

      this.requestCount += 1;
      this._log?.request({ method, path: "(upload)", status: res.status, durationMs: Date.now() - started, attempt });

      if (res.ok) return;
      if (shouldRetry({ method, status: res.status, attempt, attempts: this._retry.attempts })) {
        await sleep(retryAfterMs(res.headers) ?? backoffMs(attempt, this._retry, this._random));
        continue;
      }
      throw new AscApiError(res.status, method, "(upload)", [{ title: "Chunk upload failed" }]);
    }
  }
}
