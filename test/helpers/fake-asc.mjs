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
 * `firstProductPolicy` models the one thing not yet seen on a live account
 * (#408): whether App Store Connect takes an app's first subscription or in-app
 * purchase by API. "accept" takes it; "refuse" answers the item with a 409;
 * "refuse-on-submit" takes the item and refuses the final submit. The refusal
 * wording is modelled, not Apple's verbatim text. `appPrivacyPublished: false`
 * refuses the final submit the way App Store Connect does when the App Privacy
 * answers were never published.
 *
 * @param {{ appId?: string, appName?: string, baseUrl?: string, assetLibrary?: boolean, firstSubscription?: boolean, approvedPurchase?: boolean, firstProductPolicy?: "accept"|"refuse"|"refuse-on-submit", appPrivacyPublished?: boolean }} [options]
 */
export function createFakeAsc({
  appId = "1234567890",
  appName = "Wellness",
  baseUrl = "https://api.appstoreconnect.apple.com",
  assetLibrary = true,
  firstSubscription = false,
  approvedPurchase = false,
  firstProductPolicy = "accept",
  appPrivacyPublished = true,
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
    usesNonExemptEncryption: null,
  });
  put("buildBetaDetails", "build-7", {
    internalBuildState: "READY_FOR_BETA_TESTING",
    externalBuildState: "READY_FOR_BETA_SUBMISSION",
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
  // Unless asked otherwise, the app already sells an approved yearly plan, so the
  // monthly one is not its first subscription and may be submitted by API —
  // Apple sends a first subscription through the website with the binary.
  // An approved one-time purchase already on sale, when asked for: later ones may
  // then be submitted by API.
  if (approvedPurchase) {
    put(
      "inAppPurchases",
      "iap-0",
      { productId: "com.example.wellness.tip", name: "Tip", state: "APPROVED", inAppPurchaseType: "CONSUMABLE" },
      { app: ref("apps", appId) },
    );
  }
  if (!firstSubscription) {
    put(
      "subscriptions",
      "sub-0",
      { productId: "com.example.wellness.yearly", name: "Yearly", state: "APPROVED" },
      { group: ref("subscriptionGroups", "grp-1") },
    );
    put(
      "subscriptionGroupVersions",
      "grpver-0",
      { state: "APPROVED", version: 1 },
      { subscriptionGroup: ref("subscriptionGroups", "grp-1") },
    );
  }
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

  // Customer reviews: a mix of ratings and territories, one already answered.
  for (const [id, rating, title, body, territory, date] of [
    ["rev-1", 5, "Love it", "Exactly the gentle nudge I needed.", "USA", "2026-10-09T08:00:00Z"],
    ["rev-2", 2, "Crashes", "It closes when I open Insights on my iPad.", "USA", "2026-10-08T20:00:00Z"],
    ["rev-3", 1, "Çok kötü", "Bildirimler gelmiyor.", "TUR", "2026-10-07T12:00:00Z"],
    ["rev-4", 4, "Nice", "Would love a widget.", "GBR", "2026-10-05T09:30:00Z"],
  ]) {
    put("customerReviews", /** @type {string} */ (id), {
      rating,
      title,
      body,
      reviewerNickname: `user-${id}`,
      territory,
      createdDate: date,
    });
  }
  put(
    "customerReviewResponses",
    "resp-4",
    { responseBody: "A widget is on the way!", state: "PUBLISHED", lastModifiedDate: "2026-10-06T10:00:00Z" },
    { review: ref("customerReviews", "rev-4") },
  );
  put("customerReviewSummarizations", "sum-1", {
    locale: "en-US",
    text: "People like the gentle reminders; some report crashes in Insights on iPad.",
    platform: "IOS",
    createdDate: "2026-10-09T00:00:00Z",
  });

  // ── Derived state: what Apple computes, not what anyone writes ────────────
  /** Apple's derived states: a product is READY_TO_SUBMIT once it has everything review needs. */
  function refreshSubscriptionState() {
    for (const sub of all("subscriptions")) {
      if (["WAITING_FOR_REVIEW", "IN_REVIEW", "APPROVED"].includes(sub.attributes.state)) continue;
      const group = all("subscriptionGroups").find((g) =>
        (g.relationships?.subscriptions?.data ?? []).some((/** @type {any} */ d) => d.id === sub.id),
      );
      const hasLoc = all("subscriptionLocalizations").some((l) => rel(l, "subscription")?.id === sub.id);
      const hasGroupLoc = all("subscriptionGroupLocalizations").some(
        (l) => rel(l, "subscriptionGroup")?.id === group?.id,
      );
      const hasPrice = all("subscriptionPrices").some((p) => rel(p, "subscription")?.id === sub.id);
      const shot = all("subscriptionAppStoreReviewScreenshots").find((s) => rel(s, "subscription")?.id === sub.id);
      const complete = hasLoc && hasGroupLoc && hasPrice && shot?.attributes.assetDeliveryState?.state === "COMPLETE";
      sub.attributes.state = complete ? "READY_TO_SUBMIT" : "MISSING_METADATA";
    }
    for (const iap of all("inAppPurchases")) {
      if (["WAITING_FOR_REVIEW", "IN_REVIEW", "APPROVED"].includes(iap.attributes.state)) continue;
      const versions = all("inAppPurchaseVersions").filter((v) => rel(v, "inAppPurchase")?.id === iap.id);
      const hasLoc = all("inAppPurchaseLocalizations").some((l) =>
        versions.some((v) => v.id === rel(l, "version")?.id),
      );
      const hasAvailability = all("inAppPurchaseAvailabilities").some((a) => rel(a, "inAppPurchase")?.id === iap.id);
      const hasPrice = all("inAppPurchasePrices").some((p) => rel(p, "inAppPurchaseV2")?.id === iap.id);
      const shot = all("inAppPurchaseAppStoreReviewScreenshots").find((s) => rel(s, "inAppPurchaseV2")?.id === iap.id);
      const complete =
        hasLoc && hasAvailability && hasPrice && shot?.attributes.assetDeliveryState?.state === "COMPLETE";
      iap.attributes.state = complete ? "READY_TO_SUBMIT" : "MISSING_METADATA";
    }
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
  on("GET", `/v1/subscriptions/:id/prices`, (m) => {
    const prices = all("subscriptionPrices").filter((p) => rel(p, "subscription")?.id === m[1]);
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

  // Creating subscriptions and groups, and introductory offers
  on("POST", `/v1/subscriptionGroups`, (_m, { body }) => {
    const g = put("subscriptionGroups", nextId("grp"), body.data.attributes, {
      ...body.data.relationships,
      subscriptions: { data: [] },
    });
    return created(g);
  });
  on("POST", `/v1/subscriptions`, (_m, { body }) => {
    const sub = put(
      "subscriptions",
      nextId("sub"),
      { ...body.data.attributes, state: "MISSING_METADATA" },
      body.data.relationships,
    );
    const g = get("subscriptionGroups", body.data.relationships.group.data.id);
    if (g)
      g.relationships = {
        ...g.relationships,
        subscriptions: {
          data: [...(g.relationships?.subscriptions?.data ?? []), { type: "subscriptions", id: sub.id }],
        },
      };
    return created(sub);
  });
  on("GET", `/v1/subscriptions/:id/introductoryOffers`, (m) =>
    ok(all("subscriptionIntroductoryOffers").filter((o) => rel(o, "subscription")?.id === m[1])),
  );
  on("POST", `/v1/subscriptionIntroductoryOffers`, create("subscriptionIntroductoryOffers", "offer"));

  // One-time in-app purchases (API 4.4.1 shapes)
  on("GET", `/v1/apps/${appId}/inAppPurchasesV2`, (_m, { url }) => {
    const productId = url.searchParams.get("filter[productId]");
    return ok(all("inAppPurchases").filter((p) => !productId || p.attributes.productId === productId));
  });
  on("POST", `/v2/inAppPurchases`, create("inAppPurchases", "iap", { state: "MISSING_METADATA" }));
  on("GET", `/v2/inAppPurchases/:id/versions`, (m) =>
    ok(all("inAppPurchaseVersions").filter((v) => rel(v, "inAppPurchase")?.id === m[1])),
  );
  on("POST", `/v1/inAppPurchaseVersions`, (_m, { body }) => {
    const iapId = body.data.relationships.inAppPurchase.data.id;
    const n = all("inAppPurchaseVersions").filter((v) => rel(v, "inAppPurchase")?.id === iapId).length + 1;
    return created(
      put(
        "inAppPurchaseVersions",
        nextId("iapver"),
        { state: "PREPARE_FOR_SUBMISSION", version: n },
        body.data.relationships,
      ),
    );
  });
  on("GET", `/v1/inAppPurchaseVersions/:id/localizations`, (m) =>
    ok(all("inAppPurchaseLocalizations").filter((l) => rel(l, "version")?.id === m[1])),
  );
  on("POST", `/v2/inAppPurchaseLocalizations`, create("inAppPurchaseLocalizations", "iaploc"));
  on("PATCH", `/v2/inAppPurchaseLocalizations/:id`, patch("inAppPurchaseLocalizations"));
  on("GET", `/v2/inAppPurchases/:id/inAppPurchaseAvailability`, (m) => {
    const a = all("inAppPurchaseAvailabilities").find((x) => rel(x, "inAppPurchase")?.id === m[1]);
    return a ? ok(a) : notFound();
  });
  on("POST", `/v1/inAppPurchaseAvailabilities`, create("inAppPurchaseAvailabilities", "iapavail"));
  on("GET", `/v1/territories`, () =>
    ok(["USA", "GBR", "DEU", "TUR", "JPN"].map((id) => ({ type: "territories", id, attributes: { currency: "" } }))),
  );
  on("GET", `/v2/inAppPurchases/:id/pricePoints`, () =>
    ok(
      [
        ["ipp-999", "9.99"],
        ["ipp-2999", "29.99"],
        ["ipp-4999", "49.99"],
      ].map(([id, price]) => ({ type: "inAppPurchasePricePoints", id, attributes: { customerPrice: price } })),
    ),
  );
  on("GET", `/v1/inAppPurchasePriceSchedules/:id/manualPrices`, (m) =>
    ok(all("inAppPurchasePrices").filter((p) => rel(p, "inAppPurchaseV2")?.id === m[1])),
  );
  on("POST", `/v1/inAppPurchasePriceSchedules`, (_m, { body }) => {
    const iapId = body.data.relationships.inAppPurchase.data.id;
    for (const p of all("inAppPurchasePrices"))
      if (rel(p, "inAppPurchaseV2")?.id === iapId) table("inAppPurchasePrices").delete(p.id);
    for (const inc of body.included ?? [])
      put("inAppPurchasePrices", nextId("iapprice"), inc.attributes ?? {}, inc.relationships ?? {});
    refreshSubscriptionState();
    return created({ type: "inAppPurchasePriceSchedules", id: iapId, attributes: {} });
  });
  on("GET", `/v2/inAppPurchases/:id/appStoreReviewScreenshot`, (m) => {
    const s = all("inAppPurchaseAppStoreReviewScreenshots").find((x) => rel(x, "inAppPurchaseV2")?.id === m[1]);
    return s ? ok(s) : notFound();
  });
  on("POST", `/v1/inAppPurchaseAppStoreReviewScreenshots`, reserve("inAppPurchaseAppStoreReviewScreenshots", "iaprs"));
  on("PATCH", `/v1/inAppPurchaseAppStoreReviewScreenshots/:id`, (m, { body }) => {
    const s = get("inAppPurchaseAppStoreReviewScreenshots", m[1]);
    if (!s) return notFound();
    Object.assign(s.attributes, body.data.attributes, { assetDeliveryState: { state: "COMPLETE" } });
    refreshSubscriptionState();
    return ok(s);
  });
  on("DELETE", `/v1/inAppPurchaseAppStoreReviewScreenshots/:id`, remove("inAppPurchaseAppStoreReviewScreenshots"));

  // TestFlight
  on("GET", `/v1/builds/:id`, (m) => (get("builds", m[1]) ? ok(get("builds", m[1])) : notFound()));
  on("PATCH", `/v1/builds/:id`, patch("builds"));
  on("GET", `/v1/betaBuildLocalizations`, (_m, { url }) => {
    const build = url.searchParams.get("filter[build]");
    return ok(all("betaBuildLocalizations").filter((l) => rel(l, "build")?.id === build));
  });
  on("POST", `/v1/betaBuildLocalizations`, create("betaBuildLocalizations", "bbloc"));
  on("PATCH", `/v1/betaBuildLocalizations/:id`, patch("betaBuildLocalizations"));
  on("GET", `/v1/betaAppLocalizations`, () => ok(all("betaAppLocalizations")));
  on("POST", `/v1/betaAppLocalizations`, create("betaAppLocalizations", "baloc"));
  on("PATCH", `/v1/betaAppLocalizations/:id`, patch("betaAppLocalizations"));
  on("GET", `/v1/apps/${appId}/betaAppReviewDetail`, () =>
    ok(get("betaAppReviewDetails", appId) ?? put("betaAppReviewDetails", appId, {})),
  );
  on("PATCH", `/v1/betaAppReviewDetails/:id`, patch("betaAppReviewDetails"));
  on("GET", `/v1/apps/${appId}/betaGroups`, () => ok(all("betaGroups")));
  on("POST", `/v1/betaGroups`, create("betaGroups", "bg"));
  on("GET", `/v1/betaGroups/:id/relationships/builds`, (m) =>
    ok(get("betaGroups", m[1])?.relationships?.builds?.data ?? []),
  );
  on("POST", `/v1/betaGroups/:id/relationships/builds`, (m, { body }) => {
    const g = get("betaGroups", m[1]);
    if (!g) return notFound();
    g.relationships = {
      ...g.relationships,
      builds: { data: [...(g.relationships?.builds?.data ?? []), ...body.data] },
    };
    return noContent();
  });
  on("GET", `/v1/betaTesters`, (_m, { url }) => {
    const email = url.searchParams.get("filter[email]");
    return ok(all("betaTesters").filter((t) => t.attributes.email === email));
  });
  on("POST", `/v1/betaTesters`, create("betaTesters", "tester", { state: "INVITED" }));
  on("POST", `/v1/betaGroups/:id/relationships/betaTesters`, (_m, { body }) => {
    for (const d of body.data) {
      const t = get("betaTesters", d.id);
      if (t)
        t.relationships = {
          ...t.relationships,
          betaGroups: { data: [...(t.relationships?.betaGroups?.data ?? []), { type: "betaGroups", id: _m[1] }] },
        };
    }
    return noContent();
  });
  on("GET", `/v1/builds/:id/buildBetaDetail`, (m) => ok(get("buildBetaDetails", m[1])));
  on("POST", `/v1/betaAppReviewSubmissions`, (_m, { body }) => {
    const detail = get("buildBetaDetails", body.data.relationships.build.data.id);
    if (detail) detail.attributes.externalBuildState = "WAITING_FOR_BETA_REVIEW";
    return created(
      put(
        "betaAppReviewSubmissions",
        nextId("bars"),
        { betaReviewState: "WAITING_FOR_REVIEW" },
        body.data.relationships,
      ),
    );
  });

  // Customer reviews and replies
  const responseOf = (/** @type {string} */ reviewId) =>
    all("customerReviewResponses").find((r) => rel(r, "review")?.id === reviewId);
  on("GET", `/v1/apps/${appId}/customerReviews`, (_m, { url }) => {
    const ratings = (url.searchParams.get("filter[rating]") ?? "").split(",").filter(Boolean).map(Number);
    const territory = url.searchParams.get("filter[territory]");
    const answered = url.searchParams.get("exists[publishedResponse]");
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const reviews = all("customerReviews")
      .filter((r) => !ratings.length || ratings.includes(r.attributes.rating))
      .filter((r) => !territory || r.attributes.territory === territory)
      .filter((r) => answered === null || (answered === "true") === Boolean(responseOf(r.id)))
      .sort((a, b) => b.attributes.createdDate.localeCompare(a.attributes.createdDate))
      .slice(0, limit)
      .map((r) => {
        const resp = responseOf(r.id);
        return {
          ...r,
          relationships: { response: { data: resp ? { type: "customerReviewResponses", id: resp.id } : null } },
        };
      });
    const included = reviews.map((r) => responseOf(r.id)).filter(Boolean);
    return ok(reviews, included);
  });
  on("GET", `/v1/customerReviews/:id/response`, (m) => {
    const resp = responseOf(m[1]);
    return resp ? ok(resp) : notFound();
  });
  on("POST", `/v1/customerReviewResponses`, (_m, { body }) => {
    const reviewId = body.data.relationships.review.data.id;
    if (!get("customerReviews", reviewId)) return notFound();
    const old = responseOf(reviewId);
    if (old) table("customerReviewResponses").delete(old.id);
    const r = put(
      "customerReviewResponses",
      nextId("resp"),
      {
        responseBody: body.data.attributes.responseBody,
        state: "PENDING_PUBLISH",
        lastModifiedDate: "2026-10-10T12:00:00Z",
      },
      body.data.relationships,
    );
    return created(r);
  });
  on("DELETE", `/v1/customerReviewResponses/:id`, remove("customerReviewResponses"));
  on("GET", `/v1/apps/${appId}/customerReviewSummarizations`, () => ok(all("customerReviewSummarizations")));
  // No custom EULA: Apple's standard one applies.
  on("GET", `/v1/apps/${appId}/endUserLicenseAgreement`, () => ok(all("endUserLicenseAgreements")[0] ?? null));

  // Review submissions
  const SHIPPED = ["APPROVED", "DEVELOPER_REMOVED_FROM_SALE", "REMOVED_FROM_SALE"];
  /** The item's product is the app's first of its kind. @param {Record<string, any>} rels */
  const firstProductItem = (rels) => {
    if (rels.subscriptionVersion || rels.subscriptionGroupVersion)
      return !all("subscriptions").some((x) => SHIPPED.includes(x.attributes.state));
    if (rels.inAppPurchaseVersion) return !all("inAppPurchases").some((x) => SHIPPED.includes(x.attributes.state));
    return false;
  };
  const FIRST_PRODUCT_REFUSAL =
    "The first subscription or in-app purchase for an app must be submitted with an app version in App Store Connect.";

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
  // As Apple does: relationship data only for what `include` asks for.
  on("GET", `/v1/reviewSubmissions/:id/items`, (m, { url }) => {
    const included = (url.searchParams.get("include") ?? "").split(",").filter(Boolean);
    const items = all("reviewSubmissionItems")
      .filter((i) => rel(i, "reviewSubmission")?.id === m[1])
      .map((i) => ({
        ...i,
        relationships: Object.fromEntries(
          Object.entries(i.relationships ?? {}).map(([k, v]) => [k, included.includes(k) ? v : { links: {} }]),
        ),
      }));
    return ok(items);
  });
  on("PATCH", `/v1/reviewSubmissionItems/:id`, patch("reviewSubmissionItems"));
  on("DELETE", `/v1/reviewSubmissionItems/:id`, (m) => {
    const item = get("reviewSubmissionItems", m[1]);
    if (!item) return notFound();
    const submission = get("reviewSubmissions", rel(item, "reviewSubmission")?.id);
    if (submission?.relationships?.items?.data) {
      submission.relationships.items.data = submission.relationships.items.data.filter((d) => d.id !== m[1]);
    }
    table("reviewSubmissionItems").delete(m[1]);
    return noContent();
  });
  on("POST", `/v1/reviewSubmissionItems`, (_m, { body }) => {
    const rels = body.data.relationships;
    const submission = /** @type {Resource} */ (get("reviewSubmissions", rels.reviewSubmission.data.id));
    const already = all("reviewSubmissionItems").some(
      (i) =>
        rel(i, "reviewSubmission")?.id === submission.id && JSON.stringify(i.relationships) === JSON.stringify(rels),
    );
    if (already) return conflict("ENTITY_ERROR.RELATIONSHIP.INVALID", "The item is already in this submission.");
    if (firstProductPolicy === "refuse" && firstProductItem(rels)) {
      return conflict("STATE_ERROR.ENTITY_STATE_INVALID", FIRST_PRODUCT_REFUSAL);
    }
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
      const items = all("reviewSubmissionItems").filter((i) => rel(i, "reviewSubmission")?.id === s.id);
      // As Apple does: a generic top-level error, the reasons under associatedErrors.
      const refuse = (/** @type {string} */ path, /** @type {string} */ detail) => ({
        status: 409,
        body: {
          errors: [
            {
              status: "409",
              code: "STATE_ERROR.ENTITY_STATE_INVALID",
              title: "The request cannot be fulfilled because of the state of another resource.",
              detail: `reviewSubmissions with id '${s.id}' cannot be submitted.`,
              meta: { associatedErrors: { [path]: [{ code: "STATE_ERROR", detail }] } },
            },
          ],
        },
      });
      if (!appPrivacyPublished) {
        return refuse(
          "/v1/appStoreVersions/ver-1",
          "You must have published answers to your app's data usages before you can submit for review.",
        );
      }
      if (firstProductPolicy === "refuse-on-submit" && items.some((i) => firstProductItem(i.relationships ?? {}))) {
        return refuse("/v1/subscriptions", FIRST_PRODUCT_REFUSAL);
      }
      s.attributes = { ...s.attributes, submitted: true, state: "WAITING_FOR_REVIEW" };
      for (const item of all("reviewSubmissionItems").filter((i) => rel(i, "reviewSubmission")?.id === s.id)) {
        const v = rel(item, "appStoreVersion");
        if (v) /** @type {Resource} */ (get("appStoreVersions", v.id)).attributes.appStoreState = "WAITING_FOR_REVIEW";
        const subVersion = get("subscriptionVersions", rel(item, "subscriptionVersion")?.id);
        const sub = subVersion && get("subscriptions", rel(subVersion, "subscription")?.id);
        if (sub) sub.attributes.state = "WAITING_FOR_REVIEW";
        const iapVersion = get("inAppPurchaseVersions", rel(item, "inAppPurchaseVersion")?.id);
        const iap = iapVersion && get("inAppPurchases", rel(iapVersion, "inAppPurchase")?.id);
        if (iap) iap.attributes.state = "WAITING_FOR_REVIEW";
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

/**
 * Apple's side of a rejection: the version goes back to REJECTED, the open
 * submission to UNRESOLVED_ISSUES, and its items to REJECTED, unresolved.
 *
 * @param {ReturnType<typeof createFakeAsc>} fake
 */
export function rejectSubmission(fake) {
  const version = fake.get("appStoreVersions", "ver-1");
  if (version) version.attributes.appStoreState = "REJECTED";
  for (const s of fake.all("reviewSubmissions")) s.attributes = { ...s.attributes, state: "UNRESOLVED_ISSUES" };
  for (const i of fake.all("reviewSubmissionItems"))
    i.attributes = { ...i.attributes, state: "REJECTED", resolved: false };
}
