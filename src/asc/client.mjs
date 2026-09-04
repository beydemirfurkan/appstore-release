// App Store Connect HTTP client. Single responsibility: authenticated requests +
// uniform error handling. Knows nothing about specific resources (see discovery.mjs).

const BASE_URL = "https://api.appstoreconnect.apple.com";

export class AscApiError extends Error {
  constructor(status, method, path, errors) {
    const detail = (errors || []).map((e) => `${e.title}${e.detail ? ": " + e.detail : ""}`).join("; ");
    super(`HTTP ${status} ${method} ${path}${detail ? " — " + detail : ""}`);
    this.status = status;
    this.method = method;
    this.path = path;
    this.errors = errors || [];
  }
}

export class AscClient {
  /** @param {{ tokenProvider: () => string, fetchImpl?: typeof fetch }} deps */
  constructor({ tokenProvider, fetchImpl = fetch }) {
    this._token = tokenProvider;
    this._fetch = fetchImpl;
  }

  /**
   * @param {"GET"|"POST"|"PATCH"|"DELETE"} method
   * @param {string} path
   * @param {{ body?: object, throwOnError?: boolean }} [opts]
   * When throwOnError is false, API errors resolve to `{ error: AscApiError }` instead of throwing.
   */
  async request(method, path, { body, throwOnError = true } = {}) {
    const res = await this._fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this._token()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new AscApiError(res.status, method, path, json.errors);
      if (throwOnError) throw err;
      return { error: err };
    }
    return json;
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
}
