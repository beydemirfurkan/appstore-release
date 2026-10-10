// Sales and Trends reports, read-only: downloaded (Apple sends them gzipped),
// unpacked with node:zlib, summarised — units and proceeds — and optionally
// saved as the tab-separated file Apple produced.
//
// The report types, sub-types, frequencies and versions accepted are Apple's
// table for GET /v1/salesReports; any other combination is refused before a
// request. The INSTALLS reports are left out until their rows are confirmed.

import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Status } from "../core/status.mjs";

/** reportType → { sub-type, frequencies, version } */
export const REPORTS = Object.freeze({
  SALES: { subType: "SUMMARY", frequencies: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"], version: "1_0" },
  PRE_ORDER: { subType: "SUMMARY", frequencies: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"], version: "1_0" },
  SUBSCRIPTION: { subType: "SUMMARY", frequencies: ["DAILY"], version: "1_3" },
  SUBSCRIPTION_EVENT: { subType: "SUMMARY", frequencies: ["DAILY"], version: "1_3" },
  SUBSCRIBER: { subType: "DETAILED", frequencies: ["DAILY"], version: "1_3" },
  SUBSCRIPTION_OFFER_CODE_REDEMPTION: { subType: "SUMMARY", frequencies: ["DAILY"], version: "1_0" },
});

/** An example of the date each frequency takes, for messages. */
const EXAMPLES = { DAILY: "2026-10-09", WEEKLY: "2026-10-04 (a Sunday)", MONTHLY: "2026-09", YEARLY: "2025" };

/** The date each frequency takes. */
const DATE_FORMATS = {
  DAILY: /^\d{4}-\d{2}-\d{2}$/,
  WEEKLY: /^\d{4}-\d{2}-\d{2}$/,
  MONTHLY: /^\d{4}-\d{2}$/,
  YEARLY: /^\d{4}$/,
};

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "sales",
  title: "Sales report",
  phase: "listing",
  needs: [],
  configFree: true,
  mutates: false,
  args: {
    type: { type: "string", default: "SALES", description: `report type: ${Object.keys(REPORTS).join(", ")}` },
    frequency: { type: "string", default: "DAILY", description: "DAILY, WEEKLY, MONTHLY or YEARLY" },
    date: {
      type: "string",
      description: "YYYY-MM-DD (daily, weekly), YYYY-MM (monthly), YYYY (yearly); daily defaults to the latest",
    },
    vendor: {
      type: "string",
      description: "vendor number (Payments and Financial Reports); else reports.vendorNumber or ASC_VENDOR_NUMBER",
    },
    reportVersion: { type: "string", description: "override Apple's report version, e.g. 1_3" },
    out: { type: "string", description: "also save the report (tab-separated) to this file" },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ type?: string, frequency?: string, date?: string, vendor?: string, reportVersion?: string, out?: string }} [args]
 */
export async function run(ctx, args = {}) {
  const { client, config, resolvePath } = ctx;
  const type = String(args.type ?? "SALES").toUpperCase();
  const frequency = String(args.frequency ?? "DAILY").toUpperCase();
  const spec = /** @type {Record<string, { subType: string, frequencies: string[], version: string }>} */ (REPORTS)[
    type
  ];
  if (!spec)
    return {
      status: Status.ERROR,
      message: `unknown report type ${type}; use one of ${Object.keys(REPORTS).join(", ")}`,
    };
  if (!spec.frequencies.includes(frequency)) {
    return {
      status: Status.ERROR,
      message: `${type} comes ${spec.frequencies.join(" or ").toLowerCase()}, not ${frequency.toLowerCase()}`,
    };
  }
  const format = /** @type {Record<string, RegExp>} */ (DATE_FORMATS)[frequency];
  const EXAMPLES_ = /** @type {Record<string, string>} */ (EXAMPLES);
  if (args.date && !format.test(args.date)) {
    return {
      status: Status.ERROR,
      message: `a ${frequency.toLowerCase()} report takes a date like ${EXAMPLES_[frequency]}`,
    };
  }
  if (!args.date && frequency !== "DAILY")
    return { status: Status.ERROR, message: `a ${frequency.toLowerCase()} report needs --date` };

  const vendor = args.vendor ?? config?.reports?.vendorNumber ?? process.env.ASC_VENDOR_NUMBER;
  if (!vendor) {
    return {
      status: Status.ERROR,
      message:
        "no vendor number: pass --vendor, set reports.vendorNumber, or ASC_VENDOR_NUMBER (App Store Connect → Payments and Financial Reports)",
    };
  }

  const query = [
    `filter[vendorNumber]=${encodeURIComponent(vendor)}`,
    `filter[reportType]=${type}`,
    `filter[reportSubType]=${spec.subType}`,
    `filter[frequency]=${frequency}`,
    `filter[version]=${args.reportVersion ?? spec.version}`,
    ...(args.date ? [`filter[reportDate]=${args.date}`] : []),
  ];
  const res = await client.get(`/v1/salesReports?${query.join("&")}`, { binary: true, throwOnError: false });
  if ("error" in res) {
    // No sales that day is a 404 with a sentence, not a failure.
    if (res.error?.status === 404) {
      return {
        status: Status.OK,
        message: `no ${type.toLowerCase()} report for ${args.date ?? "the latest day"}: ${res.error.message}`,
      };
    }
    return { status: Status.ERROR, message: res.error?.message ?? "the report could not be downloaded" };
  }

  const tsv = unpack(/** @type {Buffer} */ (res.bytes));
  const table = parseTsv(tsv);
  const summary = summarize(table);
  for (const line of summary.lines) ctx.log.info(line);

  if (args.out) {
    const out = resolvePath(args.out, "sales --out");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, tsv, { mode: 0o600 });
  }
  return {
    status: Status.OK,
    message: `${type.toLowerCase()} · ${frequency.toLowerCase()} ${args.date ?? "latest"} · ${table.rows.length} row(s)${summary.headline ? ` · ${summary.headline}` : ""}${args.out ? ` · saved to ${args.out}` : ""}`,
    details: {
      type,
      frequency,
      date: args.date ?? null,
      columns: table.columns,
      rows: table.rows,
      totals: summary.totals,
    },
  };
}

/** gzip, or already plain text. @param {Buffer} bytes */
export function unpack(bytes) {
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8");
}

/** @param {string} text @returns {{ columns: string[], rows: Array<Record<string, string>> }} */
export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const columns = (lines.shift() ?? "").split("\t").map((c) => c.trim());
  const rows = lines.map((l) =>
    Object.fromEntries(l.split("\t").map((v, i) => [columns[i] ?? `column ${i + 1}`, v.trim()])),
  );
  return { columns, rows };
}

/**
 * Units in total and per title, proceeds per currency — when the report has
 * those columns (the Sales report does); otherwise just the row count.
 *
 * @param {{ columns: string[], rows: Array<Record<string, string>> }} table
 */
export function summarize({ columns, rows }) {
  /** @type {{ units: number, proceeds: Record<string, number>, byTitle: Record<string, number> }} */
  const totals = { units: 0, proceeds: {}, byTitle: {} };
  if (!columns.includes("Units")) return { headline: "", lines: [], totals };
  for (const r of rows) {
    const units = Number(r.Units) || 0;
    totals.units += units;
    const title = r.Title || r.SKU || "?";
    totals.byTitle[title] = (totals.byTitle[title] ?? 0) + units;
    const currency = r["Currency of Proceeds"];
    const each = Number(r["Developer Proceeds"]);
    if (currency && Number.isFinite(each)) totals.proceeds[currency] = (totals.proceeds[currency] ?? 0) + units * each;
  }
  const money = Object.entries(totals.proceeds)
    .filter(([, v]) => v)
    .map(([c, v]) => `${v.toFixed(2)} ${c}`);
  const lines = Object.entries(totals.byTitle)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([title, units]) => `${String(units).padStart(7)}  ${title}`);
  return { headline: `${totals.units} units${money.length ? ` · proceeds ${money.join(", ")}` : ""}`, lines, totals };
}
