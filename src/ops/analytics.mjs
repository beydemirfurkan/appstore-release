// App Store analytics reports (API 4.x): App Store engagement, commerce, app
// usage, framework usage and performance, as files.
//
// The flow is Apple's: an app has report requests; an ONGOING request makes
// Apple produce reports from then on (the first ones take a day or two); each
// report has instances by date and granularity, each instance has segments, and
// each segment is a file behind a signed URL. This lists what exists, creates
// the ongoing request when asked, and downloads one report's latest instance.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Status } from "../core/status.mjs";
import { unpack } from "./sales.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "analytics",
  title: "Analytics reports",
  phase: "listing",
  needs: [],
  configFree: true,
  mutates: true,
  args: {
    request: {
      type: "boolean",
      default: false,
      description: "start Apple's ongoing analytics reports for this app (once)",
    },
    category: {
      type: "string",
      description: "APP_USAGE, APP_STORE_ENGAGEMENT, COMMERCE, FRAMEWORK_USAGE or PERFORMANCE",
    },
    report: { type: "string", description: "download this report (its name, as listed)" },
    granularity: { type: "string", default: "DAILY", description: "DAILY, WEEKLY or MONTHLY" },
    out: { type: "string", default: "./analytics", description: "where downloaded reports are written" },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ request?: boolean, category?: string, report?: string, granularity?: string, out?: string }} [args]
 */
export async function run(ctx, args = {}) {
  const { client, discovery, resolvePath } = ctx;
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(String(args.granularity ?? "DAILY").toUpperCase())) {
    return { status: Status.ERROR, message: `granularity is DAILY, WEEKLY or MONTHLY, not ${args.granularity}` };
  }
  const requests = await client.all(`/v1/apps/${discovery.appId}/analyticsReportRequests?filter[accessType]=ONGOING`, {
    limit: 50,
  });
  let request = requests.find((r) => !r.attributes?.stoppedDueToInactivity);
  const stopped = requests.find((r) => r.attributes?.stoppedDueToInactivity);

  if (!request) {
    if (!args.request) {
      return {
        status: Status.OK,
        message: stopped
          ? "Apple stopped this app's analytics reports for inactivity: run analytics --request to start them again"
          : "no analytics reports yet: run analytics --request to have Apple start producing them (the first take a day or two)",
        details: { reports: [] },
      };
    }
    if (ctx.dryRun) return { status: Status.OK, message: "would request ongoing analytics reports" };
    request = (
      await client.post(`/v1/analyticsReportRequests`, {
        data: {
          type: "analyticsReportRequests",
          attributes: { accessType: "ONGOING" },
          relationships: { app: { data: { type: "apps", id: discovery.appId } } },
        },
      })
    ).data;
    return {
      status: Status.CHANGED,
      message:
        "requested ongoing analytics reports; Apple produces the first within a day or two — run analytics again then",
      details: { requestId: request.id },
    };
  }

  const category = args.category ? `?filter[category]=${encodeURIComponent(args.category.toUpperCase())}` : "";
  const reports = await client.all(`/v1/analyticsReportRequests/${request.id}/reports${category}`, { limit: 200 });
  const listed = reports.map((r) => ({
    id: r.id,
    name: r.attributes?.name ?? "",
    category: r.attributes?.category ?? "",
  }));

  if (!args.report) {
    for (const r of listed) ctx.log.info(`${r.category.padEnd(22)} ${r.name}`);
    return {
      status: Status.OK,
      message: `${listed.length} report${listed.length === 1 ? "" : "s"} available${listed.length ? ' — analytics --report "<name>" to download one' : ""}`,
      details: { requestId: request.id, reports: listed },
    };
  }

  const wanted = listed.find((r) => r.name.toLowerCase() === String(args.report).toLowerCase());
  if (!wanted) return { status: Status.ERROR, message: `no report named "${args.report}"; run analytics to list them` };

  const granularity = String(args.granularity ?? "DAILY").toUpperCase();
  const instances = await client.all(`/v1/analyticsReports/${wanted.id}/instances?filter[granularity]=${granularity}`, {
    limit: 200,
  });
  const latest = [...instances].sort((a, b) =>
    String(b.attributes?.processingDate ?? "").localeCompare(String(a.attributes?.processingDate ?? "")),
  )[0];
  if (!latest) return { status: Status.OK, message: `"${wanted.name}" has no ${granularity.toLowerCase()} data yet` };

  const date = latest.attributes?.processingDate ?? "latest";
  if (ctx.dryRun) return { status: Status.OK, message: `would download "${wanted.name}" for ${date}` };

  const segments = await client.all(`/v1/analyticsReportInstances/${latest.id}/segments`, { limit: 200 });
  const dir = resolvePath(args.out ?? "./analytics", "analytics --out");
  mkdirSync(dir, { recursive: true });
  const base = wanted.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const files = [];
  for (const [i, segment] of segments.entries()) {
    const url = segment.attributes?.url;
    if (!url) continue;
    const text = unpack(await client.download(url));
    const file = join(dir, `${base}-${granularity.toLowerCase()}-${date}${segments.length > 1 ? `-${i + 1}` : ""}.txt`);
    writeFileSync(file, text);
    files.push(file);
  }
  return {
    status: Status.OK,
    message: `"${wanted.name}" ${granularity.toLowerCase()} ${date}: ${files.length} file(s) in ${args.out ?? "./analytics"}`,
    details: { files },
  };
}
