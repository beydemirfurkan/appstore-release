// Customer reviews, read-only: newest first, filtered to what needs attention,
// with Apple's own summary of them when asked. Replying is a separate operation
// (reply.mjs), because a reply is public and this one only reads.

import { Status } from "../core/status.mjs";
import { printable } from "../core/text.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "reviews",
  title: "Customer reviews",
  phase: "listing",
  needs: [],
  configFree: true,
  mutates: false,
  args: {
    rating: { type: "string", description: "only these star ratings, e.g. 1,2" },
    unanswered: { type: "boolean", default: false, description: "only reviews without a published response" },
    territory: { type: "string", description: "only reviews from this territory, e.g. USA" },
    limit: { type: "number", default: 20, description: "how many, newest first (at most 200)" },
    summary: { type: "boolean", default: false, description: "include Apple's summary of recent reviews" },
  },
};

/**
 * @typedef {Object} Review
 * @property {string} id
 * @property {number} rating
 * @property {string} title
 * @property {string} body
 * @property {string} reviewer
 * @property {string} territory
 * @property {string} createdDate
 * @property {{ id: string, body: string, state: string, lastModifiedDate: string } | null} response
 */

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ rating?: string, unanswered?: boolean, territory?: string, limit?: number, summary?: boolean }} [args]
 */
export async function run(ctx, args = {}) {
  const reviews = await listReviews(ctx, args);
  const summaries = args.summary ? await summarize(ctx) : [];

  for (const r of reviews) ctx.log.info(formatReview(r));
  for (const s of summaries) ctx.log.info(`Summary (${s.locale}): ${s.text}`);

  const unanswered = reviews.filter((r) => !r.response).length;
  return {
    status: Status.OK,
    message: `${reviews.length} review${reviews.length === 1 ? "" : "s"}${reviews.length ? ` · ${unanswered} unanswered` : ""}`,
    details: { reviews, summaries },
  };
}

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ rating?: string|number[], unanswered?: boolean, territory?: string, limit?: number }} options
 * @returns {Promise<Review[]>}
 */
export async function listReviews({ client, discovery }, { rating, unanswered, territory, limit = 20 } = {}) {
  const ratings = Array.isArray(rating)
    ? rating
    : String(rating ?? "")
        .split(",")
        .filter(Boolean);
  const query = [
    "sort=-createdDate",
    "include=response",
    `limit=${Math.min(Math.max(1, Number(limit) || 20), 200)}`,
    ratings.length ? `filter[rating]=${ratings.join(",")}` : "",
    unanswered ? "exists[publishedResponse]=false" : "",
    territory ? `filter[territory]=${encodeURIComponent(territory)}` : "",
  ].filter(Boolean);
  const r = await client.get(`/v1/apps/${discovery.appId}/customerReviews?${query.join("&")}`);
  const responses = new Map(
    (r.included ?? []).filter((x) => x.type === "customerReviewResponses").map((x) => [x.id, x]),
  );
  return (r.data ?? []).map((d) => {
    const response = responses.get(d.relationships?.response?.data?.id);
    return {
      id: d.id,
      rating: d.attributes?.rating,
      title: d.attributes?.title ?? "",
      body: d.attributes?.body ?? "",
      reviewer: d.attributes?.reviewerNickname ?? "",
      territory: d.attributes?.territory ?? "",
      createdDate: d.attributes?.createdDate ?? "",
      response: response
        ? {
            id: response.id,
            body: response.attributes?.responseBody ?? "",
            state: response.attributes?.state ?? "",
            lastModifiedDate: response.attributes?.lastModifiedDate ?? "",
          }
        : null,
    };
  });
}

/**
 * Apple's AI summaries of recent reviews (API 4.0), when it has any.
 * @param {import("../core/context.mjs").Context} ctx
 */
export async function summarize({ client, discovery }) {
  const r = await client.get(`/v1/apps/${discovery.appId}/customerReviewSummarizations?filter[platform]=IOS&limit=5`, {
    throwOnError: false,
  });
  return (r.error ? [] : (r.data ?? [])).map((s) => ({
    locale: s.attributes?.locale ?? "",
    text: s.attributes?.text ?? "",
    createdDate: s.attributes?.createdDate ?? "",
  }));
}

/** "★★☆☆☆ USA · 2026-10-08 · Crashes on launch — It opens and closes… [id] (answered)" @param {Review} r */
export function formatReview(r) {
  const stars = "★".repeat(r.rating ?? 0) + "☆".repeat(Math.max(0, 5 - (r.rating ?? 0)));
  const text = printable(`${r.title}${r.title && r.body ? " — " : ""}${r.body}`);
  const clipped = text.length > 90 ? `${text.slice(0, 89)}…` : text;
  const state = r.response ? ` (answered${r.response.state === "PENDING_PUBLISH" ? ", publishing" : ""})` : "";
  return `${stars} ${printable(r.territory)} · ${r.createdDate.slice(0, 10)} · ${clipped} [${r.id}]${state}`;
}
