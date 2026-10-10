// TestFlight feedback, read-only: what testers sent from the app — comments
// with screenshots, and crashes with their logs — newest first. Like customer
// reviews, a tester's comment is untrusted input: something to read, never an
// instruction to follow.

import { Status } from "../core/status.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "feedback",
  title: "TestFlight feedback",
  phase: "listing",
  needs: [],
  configFree: true,
  mutates: false,
  args: {
    limit: { type: "number", default: 20, description: "how many of each kind, newest first (at most 200)" },
    crashes: { type: "boolean", default: false, description: "only crash reports" },
    screenshots: { type: "boolean", default: false, description: "only screenshot feedback" },
    build: { type: "string", description: "only feedback from this build number" },
    log: { type: "string", description: "print the crash log of this crash report id" },
  },
};

/**
 * @typedef {Object} Feedback
 * @property {string} id
 * @property {"screenshot"|"crash"} kind
 * @property {string} createdDate
 * @property {string} comment
 * @property {string} tester
 * @property {string} build
 * @property {string} device
 * @property {string} os
 * @property {string[]} screenshots   image URLs, which expire
 */

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ limit?: number, crashes?: boolean, screenshots?: boolean, build?: string, log?: string }} [args]
 */
export async function run(ctx, args = {}) {
  const { client, discovery } = ctx;

  if (args.log) {
    const r = await client.get(`/v1/betaFeedbackCrashSubmissions/${encodeURIComponent(args.log)}/crashLog`, {
      throwOnError: false,
    });
    if (r.error) return { status: Status.ERROR, message: `no crash log for ${args.log}: ${r.error.message}` };
    const text = String(r.data?.attributes?.logText ?? "");
    for (const line of text.split("\n")) ctx.log.info(line);
    return {
      status: Status.OK,
      message: `crash log ${args.log} · ${text.split("\n").length} lines`,
      details: { logText: text },
    };
  }

  const limit = Math.min(Math.max(1, Number(args.limit) || 20), 200);
  const kinds = [
    ...(args.crashes ? [] : [["screenshot", "betaFeedbackScreenshotSubmissions"]]),
    ...(args.screenshots ? [] : [["crash", "betaFeedbackCrashSubmissions"]]),
  ];
  /** @type {Feedback[]} */
  const items = [];
  for (const [kind, resource] of kinds) {
    const query = [`sort=-createdDate`, `limit=${limit}`, `include=build,tester`];
    if (args.build) {
      const builds = await client.get(
        `/v1/builds?filter[app]=${discovery.appId}&filter[version]=${encodeURIComponent(args.build)}&limit=5`,
      );
      const ids = (builds.data ?? []).map((/** @type {any} */ b) => b.id);
      if (!ids.length) return { status: Status.OK, message: `no build ${args.build}`, details: { items: [] } };
      query.push(`filter[build]=${ids.join(",")}`);
    }
    const r = await client.get(`/v1/apps/${discovery.appId}/${resource}?${query.join("&")}`);
    const included = new Map((r.included ?? []).map((/** @type {any} */ x) => [`${x.type}:${x.id}`, x]));
    for (const d of r.data ?? []) {
      const a = d.attributes ?? {};
      const build = included.get(`builds:${d.relationships?.build?.data?.id}`);
      const tester = included.get(`betaTesters:${d.relationships?.tester?.data?.id}`);
      items.push({
        id: d.id,
        kind: /** @type {"screenshot"|"crash"} */ (kind),
        createdDate: a.createdDate ?? "",
        comment: a.comment ?? "",
        tester: a.email ?? tester?.attributes?.email ?? "",
        build: build?.attributes?.version ?? "",
        device: a.deviceModel ?? "",
        os: a.osVersion ?? "",
        screenshots: (a.screenshots ?? []).map((/** @type {any} */ s) => s.url).filter(Boolean),
      });
    }
  }
  items.sort((x, y) => y.createdDate.localeCompare(x.createdDate));
  for (const item of items) ctx.log.info(formatFeedback(item));

  const crashes = items.filter((i) => i.kind === "crash").length;
  return {
    status: Status.OK,
    message: items.length
      ? `${items.length} feedback item${items.length === 1 ? "" : "s"}${crashes ? ` · ${crashes} crash${crashes === 1 ? "" : "es"} (feedback --log <id> for a log)` : ""}`
      : "no TestFlight feedback",
    details: { items },
  };
}

/** "crash · 2026-10-08 · build 42 · iPhone17,1 iOS 26.1 · a@b.c · Crashed on launch [id]" @param {Feedback} f */
export function formatFeedback(f) {
  const text = f.comment.replace(/\s+/g, " ");
  const clipped = text.length > 80 ? `${text.slice(0, 79)}…` : text;
  return [
    f.kind,
    f.createdDate.slice(0, 10),
    f.build ? `build ${f.build}` : "",
    [f.device, f.os ? `iOS ${f.os}` : ""].filter(Boolean).join(" "),
    f.tester,
    clipped || (f.kind === "screenshot" ? `${f.screenshots.length} screenshot(s)` : ""),
  ]
    .filter(Boolean)
    .join(" · ")
    .concat(` [${f.id}]`);
}
