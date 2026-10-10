// Creates/uses the review submission and submits the app version — together with
// the configured subscriptions and in-app purchases that need review.
//
// Since App Store Connect API 4.4.1, subscriptions, their groups and in-app
// purchases have versions, and reviewSubmissionItems accepts
// `subscriptionVersion`, `subscriptionGroupVersion` and `inAppPurchaseVersion`.
// An app's FIRST product goes with an app version; Apple's help describes doing
// that from the website, and teams do it by API in the same submission. So it is
// tried by API, and if App Store Connect refuses, nothing is submitted: the
// product items this submission holds are removed again and the website's
// clicks are shown. `--skip-products` sends the app alone.
import { Status } from "../core/status.mjs";
import { finding, Category, FixOwner } from "../core/findings.mjs";
import { getReadinessReport } from "../report/report.mjs";
import { REJECTION_FINDINGS } from "../report/checks/review.mjs";
import { FIRST_PRODUCT_CLICKS, isFirstProduct, purchaseConfigs, subscriptionConfigs } from "../core/products.mjs";
import { explainRefusal, isProductLine, refusedKinds } from "../asc/refusals.mjs";
import { recordRefusals } from "../core/state.mjs";

/** Review submission item relationships that carry a product rather than the app. */
const PRODUCT_RELATIONSHIPS = ["subscriptionGroupVersion", "subscriptionVersion", "inAppPurchaseVersion"];

/** What to run after a submission, to follow it to Apple's answer. */
export const FOLLOW_COMMAND = "appstore-release check --wait 30";

/** A draft submission we may add items to and finalize. */
const DRAFT_STATES = ["READY_FOR_REVIEW", "UNRESOLVED_ISSUES"];
/** Already with Apple — never add to it and never create a second one. */
const SUBMITTED_STATES = ["WAITING_FOR_REVIEW", "IN_REVIEW", "COMPLETING"];
/** Subscription/group versions still editable, i.e. the ones that can be submitted. */
const DRAFT_VERSION_STATES = ["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "REJECTED", "DEVELOPER_REJECTED"];

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "submit",
  title: "Submit for review",
  phase: "submit",
  needs: [],
  mutates: true,
  irreversible: true,
  args: {
    submit: {
      type: "boolean",
      default: false,
      description: "actually finalize the submission; without it the submission is only prepared",
    },
    force: {
      type: "boolean",
      default: false,
      description: "submit even though the readiness report still has blockers",
    },
    resolved: {
      type: "boolean",
      default: false,
      description: "after a rejection: you have addressed what App Review asked for — resubmit",
    },
    skipProducts: {
      type: "boolean",
      default: false,
      description: "submit the app version alone; subscriptions and in-app purchases wait for a later version",
    },
  },
};

/**
 * @typedef {Object} Item
 * @property {"appStoreVersion"|"subscriptionGroupVersion"|"subscriptionVersion"|"inAppPurchaseVersion"} relationship
 * @property {string} type
 * @property {string} id         the related resource's id
 * @property {string} label
 * @property {"subscription"|"iap"} [product]
 * @property {boolean} [first]   part of the app's first product of its kind
 * @property {string} [productId]
 */

/** @param {import("../core/context.mjs").Context} ctx */
export async function run(ctx, args = {}) {
  const { client, discovery, config } = ctx;
  const appId = discovery.appId;

  // Already with Apple? Then this is a no-op, checked before anything else —
  // the version is no longer editable, and "not ready" would be the wrong answer.
  const open = await client.get(
    `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS` +
      `&filter[state]=${[...DRAFT_STATES, ...SUBMITTED_STATES].join(",")}&limit=10`,
  );
  const inFlight = (open.data ?? []).find((s) => SUBMITTED_STATES.includes(s.attributes.state));
  if (inFlight) {
    return {
      status: Status.OK,
      message: `already submitted (${inFlight.attributes.state}) — nothing to do but wait`,
      details: { submissionId: inFlight.id, state: inFlight.attributes.state },
    };
  }

  // The guardrail a plain API wrapper cannot offer: we know what "ready" means,
  // so we can decline to spend a review cycle on a submission Apple will bounce.
  // Only checked when actually finalizing — preparing is harmless.
  if (args.submit && !args.force) {
    const report = await getReadinessReport(ctx);
    // A rejected version is resubmittable once the user says the reviewer's
    // points are addressed — the API cannot read Resolution Center to check —
    // and nothing else is still in the way.
    // Sending the app alone: what is wrong with the products is not in its way.
    const productFinding = (/** @type {string} */ id) => /^(subscription|iap|product)\./.test(id);
    const blocking = report.findings.filter(
      (f) => f.severity === "blocker" && !(args.skipProducts && productFinding(f.id)),
    );
    const othersBlocking = blocking.filter((f) => !REJECTION_FINDINGS.includes(f.id));
    const ready =
      report.verdict === "ready" || (args.skipProducts && report.verdict !== "rejected" && !blocking.length);
    const resubmit = report.verdict === "rejected" && args.resolved && !othersBlocking.length;
    if (!ready && !resubmit) {
      return {
        status: Status.ERROR,
        message:
          report.verdict === "rejected"
            ? othersBlocking.length
              ? `rejected, and ${othersBlocking.length} other blocker(s) remain — run release, then submit --submit --resolved`
              : "Apple rejected this version: read Resolution Center, fix it, then submit --submit --resolved"
            : `not ready to submit (${report.verdict}); pass --force to submit anyway`,
        details: report,
        findings: report.findings,
      };
    }
  }

  const version = await discovery.editableVersion();

  let submission = (open.data ?? []).find((s) => DRAFT_STATES.includes(s.attributes.state));
  if (!submission) {
    submission = (
      await client.post(`/v1/reviewSubmissions`, {
        data: {
          type: "reviewSubmissions",
          attributes: { platform: "IOS" },
          relationships: { app: { data: { type: "apps", id: appId } } },
        },
      })
    ).data;
  }

  /** @type {Item[]} */
  const wanted = [
    {
      relationship: "appStoreVersion",
      type: "appStoreVersions",
      id: version.id,
      label: `v${version.attributes.versionString}`,
    },
  ];
  // Order matters to Apple: the version first, then each group before its plans.
  const configuredProducts = subscriptionConfigs(config).length + purchaseConfigs(config).length;
  if (!args.skipProducts) {
    wanted.push(
      ...(await subscriptionItems(
        ctx,
        subscriptionConfigs(config).map((p) => p.productId),
      )),
      ...(await purchaseItems(
        ctx,
        purchaseConfigs(config).map((p) => p.productId),
      )),
    );
  }
  const products = wanted.filter((i) => i.product);

  /** related id → its reviewSubmissionItem, for everything the submission already holds */
  const present = await existingItems(client, submission.id);
  const added = [];
  for (const item of wanted) {
    if (present.has(item.id)) continue;
    const res = await client.post(
      `/v1/reviewSubmissionItems`,
      {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
            [item.relationship]: { data: { type: item.type, id: item.id } },
          },
        },
      },
      { throwOnError: false },
    );
    if (res.error) {
      // No 409 is swallowed: a duplicate was already filtered out above, so a
      // conflict here means Apple will not review this item, and it says why.
      if (item.product) return refuseProducts(ctx, { submission, products, present, error: res.error, item, version });
      const { findings } = explainRefusal(res.error);
      return {
        status: Status.ERROR,
        message: `could not add the ${item.label} to the submission: ${res.error.message}`,
        findings: [...findings, ...(res.error.hints ?? [])],
      };
    }
    if (res.data?.id) present.set(item.id, { itemId: res.data.id, relationship: item.relationship });
    added.push(item.label);
  }

  // The app alone means the app alone: product items an earlier run left in the
  // draft come out too, or they would go to review with it.
  if (args.skipProducts) {
    const { removed, stuck } = await removeProductItems(client, present);
    if (stuck.length) {
      return {
        status: Status.ERROR,
        message:
          `could not take ${stuck.length} product item(s) out of submission ${submission.id}; ` +
          "remove them in App Store Connect before sending the app alone",
        details: { submissionId: submission.id, removed, stuck },
      };
    }
    if (removed.length) added.push(...removed.map((id) => `−${id}`));
  }

  const others = [...present.keys()].filter((id) => !wanted.some((w) => w.id === id)).length;
  const contents =
    wanted.map((i) => i.label).join(" + ") + (others ? ` + ${others} other item(s) already in the draft` : "");
  const skipped =
    args.skipProducts && configuredProducts
      ? ` — products left out (--skip-products); they go to review with a later version`
      : "";
  const items = wanted.map((i) => i.label);
  if (ctx.dryRun) {
    return {
      status: added.length || args.submit ? Status.CHANGED : Status.OK,
      message: `would ${args.submit ? "submit" : "prepare"}: ${contents}${skipped}`,
      details: { submissionId: submission.id, items },
    };
  }
  if (!args.submit) {
    return {
      status: added.length ? Status.CHANGED : Status.OK,
      message: `prepared submission ${submission.id} with ${contents} (pass --submit to finalize)${skipped}`,
      details: { submissionId: submission.id, items },
    };
  }

  // After a rejection the submission sits in UNRESOLVED_ISSUES with its items
  // unresolved. Marking them resolved is the API's "Resubmit to App Review" —
  // do it only when actually submitting, once the fixes are in.
  if (submission.attributes?.state === "UNRESOLVED_ISSUES") {
    const all = await client.all(`/v1/reviewSubmissions/${submission.id}/items`, { limit: 50 });
    for (const item of all.filter((i) => i.attributes?.resolved === false || i.attributes?.state === "REJECTED")) {
      await client.patch(`/v1/reviewSubmissionItems/${item.id}`, {
        data: { type: "reviewSubmissionItems", id: item.id, attributes: { resolved: true } },
      });
    }
  }

  const done = await client.patch(
    `/v1/reviewSubmissions/${submission.id}`,
    { data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } },
    { throwOnError: false },
  );
  if (done.error) {
    const explained = explainRefusal(done.error);
    // About a product: take the products out so the app is not held hostage to them.
    if (explained.productRelated && [...present.values()].some((v) => PRODUCT_RELATIONSHIPS.includes(v.relationship))) {
      return refuseProducts(ctx, { submission, products, present, error: done.error, version });
    }
    // About the app (App Privacy, price, screenshots…): the draft stays as it is —
    // the next submit reuses it — and each reason says what to do.
    return {
      status: Status.ERROR,
      message: `App Store Connect refused the submission: ${explained.lines.join(" · ") || done.error.message}`,
      findings: [...explained.findings, ...(done.error.hints ?? [])],
    };
  }

  return {
    status: Status.CHANGED,
    message: `sent to App Review · ${contents}${skipped}`,
    details: {
      submissionId: submission.id,
      items,
      handoff: { submissionId: submission.id, items, follow: FOLLOW_COMMAND },
    },
  };
}

/**
 * App Store Connect would not take a product with this submission. Nothing is
 * submitted: every product item the submission holds is removed again, so the
 * draft is back to the app version alone. For an app's first product that
 * leaves the website, whose clicks are given; for a later one, the reason. Any
 * reason about the app itself is kept, and `--skip-products` is only offered
 * when nothing else stands in the way.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ submission: any, products: Item[], present: Map<string, { itemId: string, relationship: string }>, error: any, item?: Item, version: any }} input
 */
async function refuseProducts(
  { client, discovery, stateDir },
  { submission, products, present, error, item, version },
) {
  const { removed, stuck } = await removeProductItems(client, present);
  const { lines, findings } = explainRefusal(error);
  const appFindings = findings.filter((f) => !isProductLine(f.detail));
  const said = lines.length ? `"${lines.join(" · ")}"` : error.message;
  const undone = [
    removed.length ? `${removed.length} product item(s) taken back out of the draft` : "",
    stuck.length
      ? `could not remove ${stuck.length} — remove ${stuck.length === 1 ? "it" : "them"} in App Store Connect`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  const alone =
    appFindings.length || stuck.length ? "" : " Or send the app alone with submit --submit --skip-products.";

  // Whose refusal it is: the item being added, or the kinds the sentences name.
  const kinds = item ? [item.product] : refusedKinds(lines);
  const firsts = [
    ...new Set(
      products
        .filter((p) => p.first && p.productId && kinds.includes(p.product) && (!item || item.first))
        .map((p) => /** @type {string} */ (p.productId)),
    ),
  ];
  const who = item ? `the ${item.label}` : "the products";

  if (!firsts.length) {
    return {
      status: Status.ERROR,
      message:
        `App Store Connect would not take ${who} with ${submission.id}: ${said}. Nothing was submitted` +
        `${undone ? `; ${undone}` : ""}. Fix what it names and submit again.${alone}`,
      details: { submissionId: submission.id, refused: lines, removed, stuck },
      findings,
    };
  }

  // App Store Connect keeps no record of this; remember it, so the next check
  // says "only you can do this" instead of "ready".
  if (stateDir) {
    const at = new Date().toISOString();
    recordRefusals(
      stateDir,
      discovery.appId,
      firsts.map((productId) => ({ productId, versionId: version.id, at, reasons: lines })),
    );
  }

  return {
    status: Status.MANUAL,
    message:
      `App Store Connect would not take the first ${firsts.length === 1 ? "product" : "products"} ` +
      `(${firsts.join(", ")}) by API: ${said}. Nothing was submitted${undone ? `; ${undone}` : ""}. ` +
      `Submit the version with ${firsts.length === 1 ? "it" : "them"} from App Store Connect.${alone}`,
    details: { submissionId: submission.id, refused: lines, removed, stuck },
    findings: [
      ...appFindings,
      ...firsts.map((productId) =>
        finding({
          id: `product.first.refused.${productId}`,
          category: Category.ASC_STATE,
          title: `Submit ${productId} with the version from App Store Connect`,
          detail: `App Store Connect refused it by API: ${said}`,
          fixOwner: FixOwner.UI,
          uiOnly: true,
          fix: "Attach it to the version and submit both, in App Store Connect.",
          fixClicks: FIRST_PRODUCT_CLICKS(productId),
          docs: "references/gotchas.md#subscriptions--iaps",
        }),
      ),
    ],
  };
}

/**
 * Delete every product item the submission holds, and forget them.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {Map<string, { itemId: string, relationship: string }>} present
 */
async function removeProductItems(client, present) {
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const stuck = [];
  for (const [relatedId, { itemId, relationship }] of [...present]) {
    if (!PRODUCT_RELATIONSHIPS.includes(relationship)) continue;
    const res = await client.delete(`/v1/reviewSubmissionItems/${itemId}`, { throwOnError: false });
    if (res?.error) stuck.push(itemId);
    else {
      removed.push(itemId);
      present.delete(relatedId);
    }
  }
  return { removed, stuck };
}

/**
 * Configured subscriptions that are ready, as versioned review items — with
 * their group's version when the group was never approved. Marked `first` when
 * the app has never had a subscription approved.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {string[]} productIds
 * @returns {Promise<Item[]>}
 */
async function subscriptionItems({ client, discovery }, productIds) {
  if (!productIds.length) return [];
  const r = await client.get(`/v1/apps/${discovery.appId}/subscriptionGroups?include=subscriptions&limit=50`);
  const all = (r.included ?? []).filter((x) => x.type === "subscriptions");
  const first = isFirstProduct(all);

  /** @type {Item[]} */
  const items = [];
  for (const productId of productIds) {
    const sub = all.find((s) => s.attributes.productId === productId);
    if (!sub || sub.attributes.state !== "READY_TO_SUBMIT") continue;
    const group = (r.data ?? []).find((g) => (g.relationships?.subscriptions?.data ?? []).some((d) => d.id === sub.id));
    const groupVersion = group ? await draftVersion(client, "subscriptionGroups", group.id) : null;
    if (groupVersion && !items.some((i) => i.id === groupVersion.id)) {
      items.push({
        relationship: "subscriptionGroupVersion",
        type: "subscriptionGroupVersions",
        id: groupVersion.id,
        label: "subscription group",
        product: "subscription",
        first,
      });
    }
    const subVersion = await draftVersion(client, "subscriptions", sub.id);
    if (subVersion) {
      items.push({
        relationship: "subscriptionVersion",
        type: "subscriptionVersions",
        id: subVersion.id,
        label: productId,
        product: "subscription",
        first,
        productId,
      });
    }
  }
  return items;
}

/**
 * Configured one-time purchases that are ready, as versioned review items,
 * marked `first` when the app has never had one approved.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {string[]} productIds
 * @returns {Promise<Item[]>}
 */
async function purchaseItems({ client, discovery }, productIds) {
  if (!productIds.length) return [];
  const all = await client.all(`/v1/apps/${discovery.appId}/inAppPurchasesV2?fields[inAppPurchases]=productId,state`, {
    limit: 200,
  });
  const first = isFirstProduct(all);
  /** @type {Item[]} */
  const items = [];
  for (const productId of productIds) {
    const iap = all.find((p) => p.attributes?.productId === productId);
    if (!iap || iap.attributes.state !== "READY_TO_SUBMIT") continue;
    const versions = await client.all(`/v2/inAppPurchases/${iap.id}/versions`, { limit: 20 });
    const draft = versions.find((v) => DRAFT_VERSION_STATES.includes(v.attributes?.state));
    if (draft) {
      items.push({
        relationship: "inAppPurchaseVersion",
        type: "inAppPurchaseVersions",
        id: draft.id,
        label: productId,
        product: "iap",
        first,
        productId,
      });
    }
  }
  return items;
}

/**
 * The editable version of a subscription or group, created when there is none
 * and nothing has ever been approved (creating one snapshots the current
 * metadata, which is what App Review then sees). An approved group with no draft
 * needs no review, so none is created for it.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {"subscriptions"|"subscriptionGroups"} parentType
 * @param {string} parentId
 */
async function draftVersion(client, parentType, parentId) {
  const versions = await client.get(`/v1/${parentType}/${parentId}/versions?limit=20`, { throwOnError: false });
  const list = versions.error ? [] : (versions.data ?? []);
  const draft = list.find((v) => DRAFT_VERSION_STATES.includes(v.attributes?.state));
  if (draft) return draft;
  if (list.some((v) => v.attributes?.state === "APPROVED")) return null;

  const type = parentType === "subscriptions" ? "subscriptionVersions" : "subscriptionGroupVersions";
  const relationship = parentType === "subscriptions" ? "subscription" : "subscriptionGroup";
  return (
    await client.post(`/v1/${type}`, {
      data: { type, relationships: { [relationship]: { data: { type: parentType, id: parentId } } } },
    })
  ).data;
}

/**
 * Everything already in the submission, as related id → its item and what kind
 * of thing it carries, so re-running adds nothing twice and a product can be
 * taken back out.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {string} submissionId
 * @returns {Promise<Map<string, { itemId: string, relationship: string }>>}
 */
async function existingItems(client, submissionId) {
  /** @type {Map<string, { itemId: string, relationship: string }>} */
  const out = new Map();
  if (submissionId.startsWith("dry:")) return out; // planned under --dry-run; nothing to read
  // Relationship ids come back only for what is included — without it every
  // item looks empty, and a re-run adds the same version again (409).
  const items = await client.all(
    `/v1/reviewSubmissions/${submissionId}/items` +
      `?include=appStoreVersion,subscriptionVersion,subscriptionGroupVersion,inAppPurchaseVersion`,
    { limit: 50 },
  );
  for (const item of items) {
    for (const [relationship, rel] of Object.entries(item.relationships ?? {})) {
      const id = /** @type {any} */ (rel)?.data?.id;
      if (id) out.set(id, { itemId: item.id, relationship });
    }
  }
  return out;
}
