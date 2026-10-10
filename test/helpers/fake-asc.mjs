// A stateful fake App Store Connect: an app that starts half-prepared and really
// changes as requests arrive, so `check → release → check → submit` can run end
// to end against it — in tests through the client's fetchImpl seam, and in the
// demo recordings over HTTP (scripts/demo/server.mjs).
//
// It models the endpoints this tool calls, in the shapes Apple documents, and
// nothing more. An unmodelled request is a 404 that is also recorded in
// `unhandled`, so a test can assert the code made no call the fake does not know.

/** @typedef {{ type: string, id: string, attributes: Record<string, any>, relationships?: Record<string, any> }} Resource */

const LOCALE = "en-US";

/**
 * The App Asset Library catalog, trimmed to the screenshot groups the demo uses,
 * in the shape of GET /v1/appAssetLibraryRefData.
 */
export const FAKE_REF_DATA = Object.freeze({
  placementProfileGroups: [
    {
      placementProfileGroupId: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE",
      platform: "IOS",
      displayClassId: "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY",
    },
    { placementProfileGroupId: "IPHONE_DUO_OUTER_PROFILE", platform: "IOS", displayClassId: "IPHONE_DUO" },
    { placementProfileGroupId: "IPHONE_DUO_INNER_PROFILE", platform: "IOS", displayClassId: "IPHONE_DUO" },
    { placementProfileGroupId: "IPAD_13_PROFILE", platform: "IOS", displayClassId: "IPAD_13_DISPLAY" },
  ],
  imageSpecs: [
    spec("i1320x2868a0", 1320, 2868),
    spec("i1290x2796a0", 1290, 2796),
    spec("i1398x2034a0", 1398, 2034),
    spec("i2007x2853a0", 2007, 2853),
    spec("i2064x2752a0", 2064, 2752),
  ],
  placementTypes: [
    {
      placementTypeId: "APP_SCREENSHOT",
      acceptsAssetCategories: ["APP_SCREENSHOTS_AND_PREVIEWS"],
      specMappings: [
        { placementGroupId: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", specs: ["i1320x2868a0", "i1290x2796a0"] },
        { placementGroupId: "IPHONE_DUO_OUTER_PROFILE", specs: ["i1398x2034a0"] },
        { placementGroupId: "IPHONE_DUO_INNER_PROFILE", specs: ["i2007x2853a0"] },
        { placementGroupId: "IPAD_13_PROFILE", specs: ["i2064x2752a0"] },
      ],
    },
  ],
  features: [
    {
      featureId: "APP_STORE_VERSIONS",
      placementPolicies: [
        {
          placementType: "APP_SCREENSHOT",
          groupLimits: [
            {
              groupIds: [
                "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE",
                "IPHONE_DUO_OUTER_PROFILE",
                "IPHONE_DUO_INNER_PROFILE",
                "IPAD_13_PROFILE",
              ],
              maxCount: 10,
            },
          ],
        },
      ],
    },
  ],
});

function spec(shortName, width, height) {
  return {
    specId: shortName,
    shortName,
    dimensions: { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height },
    alphaAllowed: false,
    fileExtensions: [".png", ".jpg", ".jpeg"],
    compatiblePlacementTypes: ["APP_SCREENSHOT"],
  };
}

/**
 * @param {{ appId?: string, appName?: string, baseUrl?: string, assetLibrary?: boolean }} [options]
 */
export function createFakeAsc({
  appId = "1234567890",
  appName = "Wellness",
  baseUrl = "https://api.appstoreconnect.apple.com",
  assetLibrary = true,
} = {}) {
  let seq = 0;
  const nextId = (/** @type {string} */ prefix) => `${prefix}-${++seq}`;

  /** @type {Map<string, Map<string, Resource>>} */
  const db = new Map();
  const table = (/** @type {string} */ type) => {
    if (!db.has(type)) db.set(type, new Map());
    return /** @type {Map<string, Resource>} */ (db.get(type));
  };
  /** @param {string} type @param {string} id @param {Record<string, any>} [attributes] @param {Record<string, any>} [relationships] */
  const put = (type, id, attributes = {}, relationships = {}) => {
    const r = { type, id, attributes, relationships };
    table(type).set(id, r);
    return r;
  };
  const get = (/** @type {string} */ type, /** @type {string} */ id) => table(type).get(id);
  const all = (/** @type {string} */ type) => [...table(type).values()];
  const rel = (/** @type {Resource} */ r, /** @type {string} */ name) => r.relationships?.[name]?.data ?? null;
  const ref = (/** @type {string} */ type, /** @type {string} */ id) => ({ data: { type, id } });

  // ── The app, mid-preparation ──────────────────────────────────────────────
  put("apps", appId, {
    name: appName,
    bundleId: "com.example.wellness",
    sku: "WELLNESS",
    primaryLocale: LOCALE,
    contentRightsDeclaration: null,
  });
  put("appStoreVersions", "ver-1", {
    versionString: "1.0",
    appStoreState: "PREPARE_FOR_SUBMISSION",
    platform: "IOS",
    copyright: null,
    releaseType: "AFTER_APPROVAL",
    earliestReleaseDate: null,
  });
  put("builds", "build-7", {
    version: "7",
    processingState: "VALID",
    expired: false,
    uploadedDate: "2026-10-09T18:00:00Z",
  });
  put("ageRatingDeclarations", "age-1", {});
  put(
    "appInfos",
    "info-1",
    { state: "PREPARE_FOR_SUBMISSION", appStoreState: "PREPARE_FOR_SUBMISSION" },
    {
      primaryCategory: { data: null },
      secondaryCategory: { data: null },
      ageRatingDeclaration: ref("ageRatingDeclarations", "age-1"),
    },
  );
  put(
    "appStoreVersionLocalizations",
    "verloc-1",
    { locale: LOCALE },
    { appStoreVersion: ref("appStoreVersions", "ver-1") },
  );
  put("appInfoLocalizations", "infoloc-1", { locale: LOCALE, name: appName }, { appInfo: ref("appInfos", "info-1") });
  for (const [id, price] of [
    ["pp-0", "0.00"],
    ["pp-299", "2.99"],
    ["pp-499", "4.99"],
  ]) {
    put("appPricePoints", id, { customerPrice: price, proceeds: price });
  }
  if (assetLibrary) put("appAssetLibraries", "lib-1", {});

  // A subscription with nothing filled in yet.
  put(
    "subscriptionGroups",
    "grp-1",
    { referenceName: "Premium" },
    { subscriptions: { data: [{ type: "subscriptions", id: "sub-1" }] } },
  );
  put(
    "subscriptions",
    "sub-1",
    { productId: "com.example.wellness.monthly", name: "Monthly", state: "MISSING_METADATA" },
    { group: ref("subscriptionGroups", "grp-1") },
  );
  for (const [id, price] of [
    ["spp-299", "2.99"],
    ["spp-499", "4.99"],
    ["spp-999", "9.99"],
  ]) {
    put(
      "subscriptionPricePoints",
      id,
      { customerPrice: price, proceeds: price },
      { territory: ref("territories", "USA") },
    );
  }

  /** @type {Array<{ method: string, path: string }>} */
  const unhandled = [];
  /** @type {Array<{ method: string, path: string, body?: any }>} */
  const calls = [];

  // ── Derived state: what Apple computes, not what anyone writes ────────────
  function refreshSubscriptionState() {
    const sub = /** @type {Resource} */ (get("subscriptions", "sub-1"));
    if (["WAITING_FOR_REVIEW", "IN_REVIEW", "APPROVED"].includes(sub.attributes.state)) return;
    const hasLoc = all("subscriptionLocalizations").some((l) => rel(l, "subscription")?.id === "sub-1");
    const hasGroupLoc = all("subscriptionGroupLocalizations").some((l) => rel(l, "subscriptionGroup")?.id === "grp-1");
    const hasPrice = all("subscriptionPrices").some((p) => rel(p, "subscription")?.id === "sub-1");
    const shot = all("subscriptionAppStoreReviewScreenshots").find((s) => rel(s, "subscription")?.id === "sub-1");
    const complete = hasLoc && hasGroupLoc && hasPrice && shot?.attributes.assetDeliveryState?.state === "COMPLETE";
    sub.attributes.state = complete ? "READY_TO_SUBMIT" : "MISSING_METADATA";
  }

  // ── Routing ───────────────────────────────────────────────────────────────
  /** @type {Array<[string, RegExp, (m: RegExpMatchArray, ctx: { url: URL, body: any }) => any]>} */
  const routes = [];
  const on = (/** @type {string} */ method, /** @type {string} */ pattern, /** @type {any} */ handler) => {
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, "([^/]+)")}$`);
    routes.push([method, re, handler]);
  };
  const ok = (/** @type {any} */ data, /** @type {any[]|undefined} */ included = undefined) => ({
    status: 200,
    body: included ? { data, included } : { data },
  });
  const created = (/** @type {any} */ data) => ({ status: 201, body: { data } });
  const noContent = () => ({ status: 204, body: null });
  const notFound = () => ({
    status: 404,
    body: { errors: [{ status: "404", code: "NOT_FOUND", title: "The specified resource does not exist" }] },
  });
  const conflict = (/** @type {string} */ code, /** @type {string} */ detail) => ({
    status: 409,
    body: { errors: [{ status: "409", code, title: "The request cannot be fulfilled", detail }] },
  });

  /** Generic PATCH: merge attributes and relationships into a stored resource. */
  const patch =
    (/** @type {string} */ type) =>
    (/** @type {RegExpMatchArray} */ m, /** @type {{ body: any }} */ { body }) => {
      const r = get(type, m[1]);
      if (!r) return notFound();
      Object.assign(r.attributes, body?.data?.attributes ?? {});
      for (const [k, v] of Object.entries(body?.data?.relationships ?? {}))
        r.relationships = { ...r.relationships, [k]: v };
      refreshSubscriptionState();
      return ok(r);
    };
  /** Generic POST: store the resource as sent, with an id. */
  const create =
    (/** @type {string} */ type, /** @type {string} */ prefix, /** @type {Record<string, any>} */ defaults = {}) =>
    (/** @type {RegExpMatchArray} */ _m, /** @type {{ body: any }} */ { body }) => {
      const r = put(
        type,
        nextId(prefix),
        { ...defaults, ...(body?.data?.attributes ?? {}) },
        body?.data?.relationships ?? {},
      );
      refreshSubscriptionState();
      return created(r);
    };
  const remove = (/** @type {string} */ type) => (/** @type {RegExpMatchArray} */ m) => {
    if (!table(type).delete(m[1])) return notFound();
    refreshSubscriptionState();
    return noContent();
  };
  /** A reservation, answered with one upload operation pointing back at us. */
  const reserve =
    (/** @type {string} */ type, /** @type {string} */ prefix, /** @type {Record<string, any>} */ extra = {}) =>
    (/** @type {RegExpMatchArray} */ _m, /** @type {{ body: any }} */ { body }) => {
      const id = nextId(prefix);
      const attrs = body?.data?.attributes ?? {};
      const r = put(
        type,
        id,
        {
          ...attrs,
          ...extra,
          uploadOperations: [
            {
              method: "PUT",
              url: `${baseUrl}/__upload/${type}/${id}`,
              length: attrs.fileSize,
              offset: 0,
              requestHeaders: [{ name: "Content-Type", value: "image/png" }],
            },
          ],
        },
        body?.data?.relationships ?? {},
      );
      return created(r);
    };

  // App, versions, builds
  on("GET", `/v1/apps/${appId}`, () => ok(get("apps", appId)));
  on("PATCH", `/v1/apps/:id`, patch("apps"));
  on("GET", `/v1/apps/${appId}/appStoreVersions`, () => ok(all("appStoreVersions")));
  on("GET", `/v1/appStoreVersions/:id`, (m) =>
    get("appStoreVersions", m[1]) ? ok(get("appStoreVersions", m[1])) : notFound(),
  );
  on("PATCH", `/v1/appStoreVersions/:id`, patch("appStoreVersions"));
  on("POST", `/v1/appStoreVersions`, create("appStoreVersions", "ver", { appStoreState: "PREPARE_FOR_SUBMISSION" }));
  on("GET", `/v1/appStoreVersions/:id/build`, (m) => {
    const id = rel(/** @type {Resource} */ (get("appStoreVersions", m[1])), "build")?.id;
    return id ? ok(get("builds", id)) : ok(null);
  });
  on("PATCH", `/v1/appStoreVersions/:id/relationships/build`, (m, { body }) => {
    const v = /** @type {Resource} */ (get("appStoreVersions", m[1]));
    v.relationships = { ...v.relationships, build: { data: body.data } };
    return noContent();
  });
  on("GET", `/v1/builds`, () => ok(all("builds")));
  on("GET", `/v1/appStoreVersions/:id/appStoreVersionPhasedRelease`, () => ok(null));

  // Localizations
  on("GET", `/v1/appStoreVersions/:id/appStoreVersionLocalizations`, (m) =>
    ok(all("appStoreVersionLocalizations").filter((l) => rel(l, "appStoreVersion")?.id === m[1])),
  );
  on("GET", `/v1/appStoreVersionLocalizations/:id`, (m) => ok(get("appStoreVersionLocalizations", m[1])));
  on("PATCH", `/v1/appStoreVersionLocalizations/:id`, patch("appStoreVersionLocalizations"));
  on("POST", `/v1/appStoreVersionLocalizations`, create("appStoreVersionLocalizations", "verloc"));
  on("GET", `/v1/apps/${appId}/appInfos`, () => {
    const info = /** @type {Resource} */ (get("appInfos", "info-1"));
    return ok([info], [get("ageRatingDeclarations", "age-1")]);
  });
  on("PATCH", `/v1/appInfos/:id`, patch("appInfos"));
  on("GET", `/v1/appInfos/:id/appInfoLocalizations`, (m) =>
    ok(all("appInfoLocalizations").filter((l) => rel(l, "appInfo")?.id === m[1])),
  );
  on("GET", `/v1/appInfoLocalizations/:id`, (m) => ok(get("appInfoLocalizations", m[1])));
  on("PATCH", `/v1/appInfoLocalizations/:id`, patch("appInfoLocalizations"));
  on("POST", `/v1/appInfoLocalizations`, create("appInfoLocalizations", "infoloc"));
  on("GET", `/v1/ageRatingDeclarations/:id`, (m) => ok(get("ageRatingDeclarations", m[1])));
  on("PATCH", `/v1/ageRatingDeclarations/:id`, patch("ageRatingDeclarations"));

  // Pricing
  on("GET", `/v1/apps/${appId}/appPricePoints`, () => ok(all("appPricePoints")));
  on("GET", `/v1/appPriceSchedules/${appId}/manualPrices`, () => {
    const prices = all("appPrices");
    const points = prices.map((p) => get("appPricePoints", rel(p, "appPricePoint")?.id)).filter(Boolean);
    return ok(prices, points);
  });
  on("POST", `/v1/appPriceSchedules`, (_m, { body }) => {
    table("appPrices").clear();
    for (const inc of body.included ?? [])
      put("appPrices", nextId("price"), inc.attributes ?? {}, inc.relationships ?? {});
    return created({ type: "appPriceSchedules", id: appId, attributes: {} });
  });

  // Review details
  on("GET", `/v1/appStoreVersions/:id/appStoreReviewDetail`, (m) => {
    const d = all("appStoreReviewDetails").find((x) => rel(x, "appStoreVersion")?.id === m[1]);
    return d ? ok(d) : notFound();
  });
  on("POST", `/v1/appStoreReviewDetails`, create("appStoreReviewDetails", "review"));
  on("PATCH", `/v1/appStoreReviewDetails/:id`, patch("appStoreReviewDetails"));

  // App Asset Library
  on("GET", `/v1/apps/${appId}/assetLibrary`, () =>
    assetLibrary ? ok(get("appAssetLibraries", "lib-1")) : notFound(),
  );
  on("GET", `/v1/appAssetLibraryRefData`, () =>
    ok([{ type: "appAssetLibraryRefData", id: "ref-1", attributes: FAKE_REF_DATA }]),
  );
  on("POST", `/v1/appAssetLibraryImages`, reserve("appAssetLibraryImages", "img", { state: "AWAITING_UPLOAD" }));
  on("PATCH", `/v1/appAssetLibraryImages/:id`, (m, { body }) => {
    const img = get("appAssetLibraryImages", m[1]);
    if (!img) return notFound();
    if (body?.data?.attributes?.uploaded) img.attributes.state = "PREPARE_FOR_SUBMISSION"; // processing is instant here
    return ok(img);
  });
  on("GET", `/v1/appAssetLibraries/:id/images`, (_m, { url }) => {
    const name = url.searchParams.get("filter[referenceName]");
    return ok(all("appAssetLibraryImages").filter((i) => !name || i.attributes.referenceName === name));
  });
  on("POST", `/v1/appAssetLibraryPlacements`, (_m, { body }) => {
    const r = put(
      "appAssetLibraryPlacements",
      nextId("plc"),
      { ...body.data.attributes, mediaType: "IMAGE", state: "PARENT_PREPARE_FOR_SUBMISSION" },
      body.data.relationships,
    );
    return created(r);
  });
  on("DELETE", `/v1/appAssetLibraryPlacements/:id`, remove("appAssetLibraryPlacements"));
  on("POST", `/v1/appAssetLibraryPlacementOrderingRequests`, (_m, { body }) => {
    const order = body.data.relationships.orderedPlacements.data.map((/** @type {any} */ d) => d.id);
    order.forEach((/** @type {string} */ id, /** @type {number} */ i) => {
      const p = get("appAssetLibraryPlacements", id);
      if (p) p.attributes.position = i;
    });
    return created({ type: "appAssetLibraryPlacementOrderingRequests", id: nextId("order"), attributes: {} });
  });
  on("GET", `/v1/appStoreVersionLocalizations/:id/placements`, (m, { url }) => {
    const group = url.searchParams.get("filter[placementGroup]");
    const placed = all("appAssetLibraryPlacements")
      .filter(
        (p) => rel(p, "appStoreVersionLocalization")?.id === m[1] && (!group || p.attributes.placementGroup === group),
      )
      .sort((a, b) => (a.attributes.position ?? 0) - (b.attributes.position ?? 0));
    const images = placed.map((p) => get("appAssetLibraryImages", rel(p, "image")?.id));
    return ok(placed, images);
  });
  on("GET", `/v1/appStoreVersionLocalizations/:id/appScreenshotSets`, () => ok([], []));

  // Subscriptions
  on("GET", `/v1/apps/${appId}/subscriptionGroups`, () => ok(all("subscriptionGroups"), all("subscriptions")));
  on("GET", `/v1/subscriptionGroups/:id/subscriptionGroupLocalizations`, (m) =>
    ok(all("subscriptionGroupLocalizations").filter((l) => rel(l, "subscriptionGroup")?.id === m[1])),
  );
  on("POST", `/v1/subscriptionGroupLocalizations`, create("subscriptionGroupLocalizations", "gloc"));
  on("PATCH", `/v1/subscriptionGroupLocalizations/:id`, patch("subscriptionGroupLocalizations"));
  on("GET", `/v1/subscriptions/:id/subscriptionLocalizations`, (m) =>
    ok(all("subscriptionLocalizations").filter((l) => rel(l, "subscription")?.id === m[1])),
  );
  on("POST", `/v1/subscriptionLocalizations`, create("subscriptionLocalizations", "sloc"));
  on("PATCH", `/v1/subscriptionLocalizations/:id`, patch("subscriptionLocalizations"));
  on("GET", `/v1/subscriptions/:id/pricePoints`, () => ok(all("subscriptionPricePoints")));
  on("GET", `/v1/subscriptions/:id/prices`, () => {
    const prices = all("subscriptionPrices");
    return ok(
      prices,
      prices.map((p) => get("subscriptionPricePoints", rel(p, "subscriptionPricePoint")?.id)).filter(Boolean),
    );
  });
  on("POST", `/v1/subscriptionPrices`, create("subscriptionPrices", "sprice"));
  on("DELETE", `/v1/subscriptionPrices/:id`, remove("subscriptionPrices"));
  on("GET", `/v1/subscriptions/:id/appStoreReviewScreenshot`, (m) => {
    const s = all("subscriptionAppStoreReviewScreenshots").find((x) => rel(x, "subscription")?.id === m[1]);
    return s ? ok(s) : notFound();
  });
  on("POST", `/v1/subscriptionAppStoreReviewScreenshots`, reserve("subscriptionAppStoreReviewScreenshots", "srs"));
  on("PATCH", `/v1/subscriptionAppStoreReviewScreenshots/:id`, (m, { body }) => {
    const s = get("subscriptionAppStoreReviewScreenshots", m[1]);
    if (!s) return notFound();
    Object.assign(s.attributes, body.data.attributes, { assetDeliveryState: { state: "COMPLETE" } });
    refreshSubscriptionState();
    return ok(s);
  });
  on("DELETE", `/v1/subscriptionAppStoreReviewScreenshots/:id`, remove("subscriptionAppStoreReviewScreenshots"));
  for (const [parent, type, relName] of [
    ["subscriptions", "subscriptionVersions", "subscription"],
    ["subscriptionGroups", "subscriptionGroupVersions", "subscriptionGroup"],
  ]) {
    on("GET", `/v1/${parent}/:id/versions`, (m) => ok(all(type).filter((v) => rel(v, relName)?.id === m[1])));
    on(
      "POST",
      `/v1/${type}`,
      create(type, type === "subscriptionVersions" ? "subver" : "grpver", {
        state: "PREPARE_FOR_SUBMISSION",
        version: 1,
      }),
    );
  }

  // Review submissions
  on("GET", `/v1/reviewSubmissions`, (_m, { url }) => {
    const states = (url.searchParams.get("filter[state]") ?? "").split(",").filter(Boolean);
    const subs = all("reviewSubmissions").filter((s) => !states.length || states.includes(s.attributes.state));
    return ok(subs, all("reviewSubmissionItems"));
  });
  on(
    "POST",
    `/v1/reviewSubmissions`,
    create("reviewSubmissions", "rs", { state: "READY_FOR_REVIEW", submitted: false }),
  );
  on("GET", `/v1/reviewSubmissions/:id/items`, (m) =>
    ok(all("reviewSubmissionItems").filter((i) => rel(i, "reviewSubmission")?.id === m[1])),
  );
  on("POST", `/v1/reviewSubmissionItems`, (_m, { body }) => {
    const rels = body.data.relationships;
    const submission = /** @type {Resource} */ (get("reviewSubmissions", rels.reviewSubmission.data.id));
    const already = all("reviewSubmissionItems").some(
      (i) =>
        rel(i, "reviewSubmission")?.id === submission.id && JSON.stringify(i.relationships) === JSON.stringify(rels),
    );
    if (already) return conflict("ENTITY_ERROR.RELATIONSHIP.INVALID", "The item is already in this submission.");
    const item = put("reviewSubmissionItems", nextId("item"), { state: "READY_FOR_REVIEW" }, rels);
    submission.relationships = {
      ...submission.relationships,
      items: {
        data: [...(submission.relationships?.items?.data ?? []), { type: "reviewSubmissionItems", id: item.id }],
      },
    };
    return created(item);
  });
  on("PATCH", `/v1/reviewSubmissions/:id`, (m, { body }) => {
    const s = get("reviewSubmissions", m[1]);
    if (!s) return notFound();
    if (body.data.attributes?.submitted) {
      s.attributes = { ...s.attributes, submitted: true, state: "WAITING_FOR_REVIEW" };
      for (const item of all("reviewSubmissionItems").filter((i) => rel(i, "reviewSubmission")?.id === s.id)) {
        const v = rel(item, "appStoreVersion");
        if (v) /** @type {Resource} */ (get("appStoreVersions", v.id)).attributes.appStoreState = "WAITING_FOR_REVIEW";
        if (rel(item, "subscriptionVersion"))
          /** @type {Resource} */ (get("subscriptions", "sub-1")).attributes.state = "WAITING_FOR_REVIEW";
      }
    }
    return ok(s);
  });

  // ── The fetch seam ────────────────────────────────────────────────────────
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    if (url.pathname.startsWith("/__upload/")) {
      // Remember the pixel size Apple would compute during processing.
      const [, , type, id] = url.pathname.split("/");
      const bytes = Buffer.from(/** @type {any} */ (init.body ?? []));
      const asset = get(type, id);
      if (asset && bytes.length >= 24 && bytes.subarray(12, 16).toString("latin1") === "IHDR") {
        asset.attributes.imageAsset = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
      }
      return new Response(null, { status: 200 });
    }
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });

    for (const [m, re, handler] of routes) {
      if (m !== method) continue;
      const match = url.pathname.match(re);
      if (!match) continue;
      const res = handler(match, { url, body });
      return new Response(res.status === 204 || res.body == null ? null : JSON.stringify(res.body), {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    }
    unhandled.push({ method, path: url.pathname });
    const nf = notFound();
    return new Response(JSON.stringify(nf.body), { status: 404, headers: { "content-type": "application/json" } });
  };

  return {
    fetchImpl,
    calls,
    unhandled,
    mutations: () => calls.filter((c) => c.method !== "GET"),
    /** Read the fake's state, for assertions. */
    get,
    all,
  };
}
