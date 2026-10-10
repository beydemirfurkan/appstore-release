// Reply to a customer review — publicly, on the App Store. One review, one
// reply, written by a person or approved by one: this operation never drafts and
// never replies in bulk. Posting again replaces the previous reply (Apple's
// "create or update"), and the same text twice is a no-op.

import { Status } from "../core/status.mjs";
import { finding, Category, FixOwner } from "../core/findings.mjs";

/** App Store Connect refuses longer responses. */
export const MAX_REPLY_LENGTH = 5970;

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "reply",
  title: "Reply to review",
  phase: "listing",
  needs: [],
  configFree: true,
  mutates: true,
  positional: "review",
  args: {
    review: { type: "string", description: "the review id (from `reviews`)" },
    text: { type: "string", description: "the reply, as it will appear on the App Store" },
    delete: { type: "boolean", default: false, description: "remove the published reply instead" },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ review?: string, text?: string, delete?: boolean }} [args]
 */
export async function run({ client }, args = {}) {
  if (!args.review) return { status: Status.ERROR, message: "which review? pass its id (see `reviews`)" };

  const current = await client.get(`/v1/customerReviews/${encodeURIComponent(args.review)}/response`, {
    throwOnError: false,
  });
  const existing = current.error ? null : (current.data ?? null);

  if (args.delete) {
    if (!existing) return { status: Status.OK, message: "no reply to remove" };
    await client.delete(`/v1/customerReviewResponses/${existing.id}`);
    return { status: Status.CHANGED, message: "reply removed" };
  }

  const text = (args.text ?? "").trim();
  const problem = replyProblem(text);
  if (problem) return { status: Status.ERROR, message: problem.title, findings: [problem] };

  if (existing?.attributes?.responseBody === text) {
    return {
      status: Status.OK,
      message: `already replied with this text (${existing.attributes?.state ?? "published"})`,
    };
  }
  const res = await client.post(`/v1/customerReviewResponses`, {
    data: {
      type: "customerReviewResponses",
      attributes: { responseBody: text },
      relationships: { review: { data: { type: "customerReviews", id: args.review } } },
    },
  });
  return {
    status: Status.CHANGED,
    message: existing ? "reply replaced · publishes shortly" : "replied · publishes shortly",
    details: { responseId: res.data?.id, state: res.data?.attributes?.state ?? "PENDING_PUBLISH" },
  };
}

/**
 * What App Store Connect would refuse, caught before the request.
 * @param {string} text
 */
export function replyProblem(text) {
  if (!text) {
    return finding({
      id: "reply.empty",
      category: Category.CONFIG,
      title: "the reply is empty",
      detail: "Pass the reply with --text.",
      fixOwner: FixOwner.CLI,
      fix: 'appstore-release reply <reviewId> --text "…"',
    });
  }
  if (text.length > MAX_REPLY_LENGTH) {
    return finding({
      id: "reply.too-long",
      category: Category.CONFIG,
      title: `the reply is ${text.length} characters; App Store Connect allows ${MAX_REPLY_LENGTH}`,
      detail: "Shorter replies read better anyway.",
      fixOwner: FixOwner.CLI,
      fix: `Shorten it to ${MAX_REPLY_LENGTH} characters or fewer.`,
    });
  }
  return null;
}
