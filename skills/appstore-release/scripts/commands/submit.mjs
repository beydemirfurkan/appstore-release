// Creates/uses the review submission and submits the app version.
//
// IMPORTANT: reviewSubmissionItems has no `subscription` relationship, so a FIRST-TIME
// subscription cannot be attached via the API. If the config declares a subscription that
// is not yet in review, this command returns MANUAL and does NOT submit — the user must
// attach it on the version page and submit in the ASC UI (bundling app + subscription).
import { Status } from "../lib/log.mjs";

const OPEN_STATES = ["READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES", "COMPLETING"];

export const meta = { id: "submit", title: "Submit for review", phase: "submit", needs: [] };

export async function run({ client, discovery, config, options = {} }) {
  const appId = discovery.appId;

  // Guard: a first-time subscription must go through the UI.
  const productId = config?.subscription?.productId;
  if (productId) {
    const { sub } = await discovery.subscription(productId);
    if (sub && sub.attributes.state === "READY_TO_SUBMIT") {
      return {
        status: Status.MANUAL,
        message:
          "first-time subscription must be attached to the version and submitted in the ASC UI " +
          "(version page → In-App Purchases and Subscriptions → Select → Save → Add for Review → Submit)",
      };
    }
  }

  // Reuse an open submission or create one.
  const existing = await client.get(
    `/v1/reviewSubmissions?filter[app]=${appId}&filter[state]=${OPEN_STATES.join(",")}&limit=5`,
    { throwOnError: false }
  );
  let submission = existing.error ? null : (existing.data || []).find((s) => s.attributes.state !== "COMPLETE");
  if (!submission) {
    submission = (
      await client.post(`/v1/reviewSubmissions`, {
        data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: appId } } } },
      })
    ).data;
  }

  // Add the app version item (idempotent — ignore "already added").
  const version = await discovery.editableVersion();
  const add = await client.post(
    `/v1/reviewSubmissionItems`,
    {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
          appStoreVersion: { data: { type: "appStoreVersions", id: version.id } },
        },
      },
    },
    { throwOnError: false }
  );
  if (add.error && !/cannot be reviewed/i.test(add.error.message) && add.error.status !== 409) {
    // "cannot be reviewed" means other required items are still missing — surface it.
    return { status: Status.ERROR, message: add.error.message };
  }
  if (add.error && /cannot be reviewed/i.test(add.error.message)) {
    return { status: Status.ERROR, message: "version not reviewable yet — run `check` to see what's missing" };
  }

  if (!options.submit) {
    return { status: Status.OK, message: `prepared submission ${submission.id} (pass --submit to finalize)` };
  }

  const done = await client.patch(
    `/v1/reviewSubmissions/${submission.id}`,
    { data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } },
    { throwOnError: false }
  );
  if (done.error) return { status: Status.ERROR, message: done.error.message };
  return { status: Status.CHANGED, message: "submitted to App Review" };
}
