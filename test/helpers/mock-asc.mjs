import { generateKeyPairSync } from "node:crypto";

// A fake App Store Connect, injected through the client's `fetchImpl` seam.
//
// `strict` is the important option: an unrouted request throws and names itself,
// so a failing test tells you exactly which call the code made that it should
// not have, instead of a null dereference three frames later.

/** @typedef {{ method: string, path: string, pathname: string, body?: any }} Call */

/**
 * @param {{ routes?: Record<string, any>, strict?: boolean }} [opts]
 */
export function createMockAsc({ routes = {}, strict = true } = {}) {
  /** @type {Call[]} */
  const calls = [];
  const compiled = Object.entries(routes).map(([key, value]) => {
    const [method, pattern] = key.split(" ");
    return { method, ...compile(pattern), value };
  });

  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method, path: url.pathname + url.search, pathname: url.pathname, body };
    calls.push(call);

    for (const route of compiled) {
      if (route.method !== method) continue;
      const params = route.match(url.pathname);
      if (!params) continue;
      const resolved = typeof route.value === "function" ? route.value({ params, call, url }) : route.value;
      return respond(resolved);
    }

    if (strict) throw new Error(`mock-asc: no route for ${method} ${url.pathname}${url.search}`);
    return respond({ status: 404, body: { errors: [{ title: "Not found (mock)" }] } });
  };

  return {
    fetchImpl,
    calls,
    /** Every request that was not a read — the assertion dry-run tests make. */
    mutations: () => calls.filter((c) => c.method !== "GET"),
    reset: () => calls.splice(0, calls.length),
  };
}

/** Turn "/v1/apps/:id/builds" into a matcher yielding { id }. */
function compile(pattern) {
  const names = [];
  const source = pattern
    .split("/")
    .map((seg) => {
      if (!seg.startsWith(":")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(seg.slice(1));
      return "([^/]+)";
    })
    .join("/");
  const re = new RegExp(`^${source}$`);
  return {
    match(pathname) {
      const m = re.exec(pathname);
      if (!m) return null;
      return Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
    },
  };
}

function respond(resolved) {
  const { status = 200, body = {}, headers = {} } = resolved?.status || resolved?.body ? resolved : { body: resolved };
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// ── A coherent app, enough for every operation to run ─────────────────────────

export const APP_ID = "1234567890";
export const VERSION_ID = "ver-1";
export const APP_INFO_ID = "info-1";
export const VERSION_LOC_ID = "verloc-1";
export const APP_INFO_LOC_ID = "infoloc-1";

const resource = (type, id, attributes = {}, relationships = {}) => ({ type, id, attributes, relationships });
const list = (data, included) => (included ? { data, included } : { data });

/**
 * Routes describing an app that is mid-preparation: an editable 1.0, a VALID
 * build, one screenshot set, one subscription still missing metadata.
 *
 * @param {{ appId?: string, locale?: string }} [opts]
 */
export function readyToPrepareRoutes({ appId = APP_ID, locale = "en-US" } = {}) {
  return {
    [`GET /v1/apps/${appId}`]: list(
      resource("apps", appId, {
        name: "Test App",
        bundleId: "com.example.test",
        sku: "TEST",
        primaryLocale: locale,
        contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT",
      }),
    ),
    [`GET /v1/apps/${appId}/appStoreVersions`]: list([
      resource("appStoreVersions", VERSION_ID, {
        versionString: "1.0",
        appStoreState: "PREPARE_FOR_SUBMISSION",
        platform: "IOS",
        copyright: "2026 Example",
      }),
    ]),
    [`GET /v1/appStoreVersions/${VERSION_ID}`]: list(
      resource("appStoreVersions", VERSION_ID, {
        versionString: "1.0",
        appStoreState: "PREPARE_FOR_SUBMISSION",
        copyright: "2026 Example",
      }),
    ),
    [`GET /v1/appStoreVersions/${VERSION_ID}/build`]: list(resource("builds", "build-1", { version: "7" })),
    [`GET /v1/apps/${appId}/appInfos`]: list(
      [
        resource(
          "appInfos",
          APP_INFO_ID,
          { appStoreState: "PREPARE_FOR_SUBMISSION" },
          {
            primaryCategory: { data: { type: "appCategories", id: "PRODUCTIVITY" } },
            secondaryCategory: { data: null },
            ageRatingDeclaration: { data: { type: "ageRatingDeclarations", id: "age-1" } },
          },
        ),
      ],
      [],
    ),
    [`GET /v1/appStoreVersions/${VERSION_ID}/appStoreVersionLocalizations`]: list([
      resource("appStoreVersionLocalizations", VERSION_LOC_ID, { locale }),
    ]),
    [`GET /v1/appStoreVersionLocalizations/${VERSION_LOC_ID}`]: list(
      resource("appStoreVersionLocalizations", VERSION_LOC_ID, {
        locale,
        description: "A test app.",
        keywords: "test,app",
        supportUrl: "https://example.com/support",
      }),
    ),
    [`GET /v1/appInfos/${APP_INFO_ID}/appInfoLocalizations`]: list([
      resource("appInfoLocalizations", APP_INFO_LOC_ID, { locale }),
    ]),
    [`GET /v1/appStoreVersionLocalizations/${VERSION_LOC_ID}/appScreenshotSets`]: list(
      [
        resource(
          "appScreenshotSets",
          "set-1",
          { screenshotDisplayType: "APP_IPHONE_67" },
          { appScreenshots: { data: [] } },
        ),
      ],
      [],
    ),
    [`GET /v1/appScreenshotSets/set-1/appScreenshots`]: list([]),
    [`GET /v1/appPriceSchedules/${appId}/manualPrices`]: list([resource("appPrices", "price-1", {})]),
    [`GET /v1/apps/${appId}/subscriptionGroups`]: list(
      [
        resource(
          "subscriptionGroups",
          "grp-1",
          { referenceName: "Main" },
          { subscriptions: { data: [{ id: "sub-1" }] } },
        ),
      ],
      [resource("subscriptions", "sub-1", { productId: "com.example.pro", state: "MISSING_METADATA", name: "Pro" })],
    ),
    [`GET /v1/builds`]: list([resource("builds", "build-1", { version: "7", processingState: "VALID" })]),
    [`GET /v1/bundleIds`]: list([resource("bundleIds", "bid-1", { identifier: "com.example.test" })]),
    [`GET /v1/certificates`]: list([]),
    [`GET /v1/profiles`]: list([]),
  };
}

/** A real ES256 key, so JWT signing is exercised rather than stubbed. */
export function testPrivateKey() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

/** Credentials wired to that key, for createContext in tests. */
export function testCredentials({ appId = APP_ID } = {}) {
  return { keyId: "ABCDE12345", issuerId: "69a6de00-0000-0000-0000-000000000000", privateKey: testPrivateKey(), appId };
}
