// Creates/uses the review submission and submits the app version — together with
// the configured subscription, when it needs review.
//
// Since App Store Connect API 4.4.1, subscriptions and subscription groups have
// versions, and reviewSubmissionItems accepts `subscriptionVersion` and
// `subscriptionGroupVersion`. That made LATER subscriptions submittable here, in
// the same submission as the app version. The app's FIRST subscription still
// goes to review from appstoreconnect.apple.com together with the binary —
// Apple says so in as many words — so it is never added by this operation.
import { Status } from "../core/status.mjs";
import { getReadinessReport } from "../report/report.mjs";
import { isFirstSubscription } from "../core/subscriptions.mjs";

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
  },
};

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
    if (report.verdict !== "ready") {
      return {
        status: Status.ERROR,
        message: `not ready to submit (${report.verdict}); pass --force to submit anyway`,
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

  const wanted = [
    {
      relationship: "appStoreVersion",
      type: "appStoreVersions",
      id: version.id,
      label: `v${version.attributes.versionString}`,
    },
  ];
  wanted.push(...(await subscriptionItems(ctx, config?.subscription?.productId)));

  const present = await existingItemIds(client, submission.id);
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
      return {
        status: Status.ERROR,
        message: `could not add the ${item.label} to the submission: ${res.error.message}`,
        findings: res.error.hints ?? [],
      };
    }
    added.push(item.label);
  }

  const contents = wanted.map((i) => i.label).join(" + ");
  if (!args.submit) {
    return {
      status: added.length ? Status.CHANGED : Status.OK,
      message: `prepared submission ${submission.id} with ${contents} (pass --submit to finalize)`,
      details: { submissionId: submission.id, items: wanted.map((i) => i.label) },
    };
  }

  const done = await client.patch(
    `/v1/reviewSubmissions/${submission.id}`,
    { data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } },
    { throwOnError: false },
  );
  if (done.error) return { status: Status.ERROR, message: done.error.message, findings: done.error.hints ?? [] };
  return {
    status: Status.CHANGED,
    message: `sent to App Review · ${contents}`,
    details: { submissionId: submission.id, items: wanted.map((i) => i.label) },
  };
}

/**
 * The subscription (and, for a new one, its group) as versioned review items.
 * A subscription already approved or already in review contributes nothing.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {string|undefined} productId
 */
async function subscriptionItems({ client, discovery }, productId) {
  if (!productId) return [];
  const { sub, group, all } = await discovery.subscription(productId);
  if (!sub || sub.attributes.state !== "READY_TO_SUBMIT") return [];
  // A first subscription is attached to the version in the web UI, not here;
  // the readiness report says so, with the clicks.
  if (isFirstSubscription(all)) return [];

  const items = [];
  const groupVersion = group ? await draftVersion(client, "subscriptionGroups", group.id) : null;
  if (groupVersion) {
    items.push({
      relationship: "subscriptionGroupVersion",
      type: "subscriptionGroupVersions",
      id: groupVersion.id,
      label: "subscription group",
    });
  }
  const subVersion = await draftVersion(client, "subscriptions", sub.id);
  if (subVersion) {
    items.push({
      relationship: "subscriptionVersion",
      type: "subscriptionVersions",
      id: subVersion.id,
      label: "subscription",
    });
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
 * Ids of everything already in the submission, so re-running adds nothing twice.
 *
 * @param {import("../asc/client.mjs").AscClient} client
 * @param {string} submissionId
 */
async function existingItemIds(client, submissionId) {
  const ids = new Set();
  if (submissionId.startsWith("dry:")) return ids; // planned under --dry-run; nothing to read
  const items = await client.all(`/v1/reviewSubmissions/${submissionId}/items`, { limit: 50 });
  for (const item of items) {
    for (const rel of Object.values(item.relationships ?? {})) {
      const id = /** @type {any} */ (rel)?.data?.id;
      if (id) ids.add(id);
    }
  }
  return ids;
}
