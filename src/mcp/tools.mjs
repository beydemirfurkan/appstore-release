// The tool surface, deliberately small.
//
// npm already has App Store Connect MCP servers advertising 162 and 1293 tools.
// Raw endpoint coverage is not the scarce thing: an agent that can call
// PATCH /v1/appStoreVersionLocalizations still does not know that whatsNew 409s
// on a first version, that emoji in the description is a hard rejection, or that
// the age-rating declaration needs all 21 attributes. Those tools hand the model
// the landmines; these eleven defuse them.
//
// The count is a product decision with a test behind it. Each tool earns its
// place by being an outcome someone wants, not an API call someone could make.
//
// A tool list is also a per-request tax on every conversation the server is
// attached to, and tool-selection accuracy falls off well before a thousand
// options. There is one job here — get an app through review — and it has one
// shape.

import { z } from "zod";

import { createContext } from "../core/context.mjs";
import { runOperation, runPipeline } from "../index.mjs";
import { getAppSnapshot } from "../report/snapshot.mjs";
import { getReadinessReport } from "../report/report.mjs";
import { renderReportMarkdown } from "../report/render.mjs";
import { validateConfig } from "../core/requirements.mjs";
import { loadConfig, findConfigPath } from "../core/config.mjs";
import { PIPELINE } from "../ops/registry.mjs";
import { Severity } from "../core/findings.mjs";

/**
 * Required on every mutating tool. A literal `true` cannot be produced by
 * accident, and the description tells the host what it is confirming — which
 * turns a mutation into a two-turn handshake the user actually sees.
 */
const confirm = z
  .literal(true)
  .describe("Must be true. Set it only after the human has approved this change to a live App Store listing.");

const appId = z.string().optional().describe("Numeric App Store Connect app id. Defaults to ASC_APP_ID.");
const configPath = z.string().optional().describe("Path to the config file. Defaults to the usual discovery order.");

/** Shared prelude: build a context, or explain why we cannot. */
async function contextOrRefusal({ appId: id, configPath: cfg, dryRun = false }, env) {
  const ctx = await createContext({
    credentials: { appId: id },
    config: cfg,
    dryRun,
    runtime: { env },
  });
  const blocking = ctx.findings.filter((f) => f.severity === Severity.BLOCKER);
  if (blocking.length) {
    return {
      refusal: structured(
        [
          "App Store Connect credentials are not configured for this server.",
          "",
          ...blocking.map((f) => `- **${f.title}** — ${f.fix}`),
          "",
          "These are read from the MCP server's own environment, never from tool arguments:",
          "ASC_KEY_ID, ASC_ISSUER_ID, ASC_P8_PATH (or ASC_P8), ASC_APP_ID.",
        ].join("\n"),
        { configured: false, findings: blocking },
      ),
    };
  }
  return { ctx };
}

/** A tool result carrying both a readable rendering and the raw object. */
function structured(text, data) {
  return { content: [{ type: "text", text }], structuredContent: data };
}

/**
 * Refuse a mutation without confirmation by returning the plan instead of an
 * error — an error reads as a malfunction, a plan reads as a question.
 */
function needsConfirmation(what, plan) {
  return structured(
    `Not done yet — confirmation required.\n\n${what}\n\n${plan}\n\nCall again with confirm: true to proceed.`,
    { confirmed: false, wouldDo: what },
  );
}

const summarizeResults = (results) =>
  results.map((r) => `- ${r.status.toUpperCase()} **${r.title}**${r.message ? ` — ${r.message}` : ""}`).join("\n");

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {{readOnlyHint: boolean, destructiveHint: boolean, idempotentHint: boolean, openWorldHint: boolean}} annotations
 * @property {Record<string, any>} inputSchema           zod shape
 * @property {(args: any) => Promise<any>} run
 */

/**
 * Build every tool definition. Kept as data so the server, the tests and the
 * docs all read from one list.
 *
 * @param {{ env?: Record<string, string|undefined>, allowLocalWrites?: boolean }} [opts]
 * @returns {ToolDef[]}
 */
export function buildTools({ env = process.env, allowLocalWrites = false } = {}) {
  return [
    {
      name: "asc_readiness_report",
      title: "App Store readiness report",
      description:
        "The main tool. Answers 'can this version be submitted, and if not, what exactly is in the way, in what order'. " +
        "Read-only. Returns findings with a verdict and an ordered list of next actions, each marked as something this " +
        "tool can fix or something only a human in App Store Connect can. Start here.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: { appId, configPath, locale: z.string().optional().describe("Locale to report on.") },
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const report = await getReadinessReport(ctx, { locale: args.locale });
        return structured(renderReportMarkdown(report), report);
      },
    },

    {
      name: "asc_app_overview",
      title: "App Store Connect inventory",
      description:
        "Read-only inventory: versions, builds, localizations, screenshot sets, pricing and subscriptions. " +
        "Use it to answer questions about current state; use asc_readiness_report to decide what to do.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: { appId, configPath, locale: z.string().optional() },
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const snapshot = await getAppSnapshot(ctx, { locale: args.locale });
        const lines = [
          `# ${snapshot.app?.attributes?.name ?? "app"} (${snapshot.app?.attributes?.bundleId ?? "?"})`,
          "",
          `Editable version: ${snapshot.version ? `${snapshot.version.attributes.versionString} (${snapshot.version.attributes.appStoreState})` : "none"}`,
          `Attached build: ${snapshot.build?.attributes?.version ?? "none"}`,
          `Price schedule: ${snapshot.pricing.hasSchedule ? "set" : "not set"}`,
          `Screenshot sets: ${snapshot.screenshotSets.map((s) => `${s.displayType} (${s.screenshots.length})`).join(", ") || "none"}`,
          `Subscriptions: ${snapshot.subscriptions.map((s) => `${s.productId} ${s.state}`).join(", ") || "none"}`,
        ];
        if (snapshot.errors.length) lines.push("", "Could not read:", ...snapshot.errors.map((e) => `- ${e}`));
        return structured(lines.join("\n"), snapshot);
      },
    },

    {
      name: "asc_list_apps",
      title: "Find an app id",
      description:
        "List the apps this API key can see, with their numeric ids and bundle ids. " +
        "Every other tool needs the numeric id, and it is the one thing people never have to hand.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: { query: z.string().optional().describe("Filter by name or bundle id, case-insensitive.") },
      async run(args) {
        // No app id needed for this one, so ask for a context without it.
        const ctx = await createContext({ runtime: { env } });
        const blocking = ctx.findings.filter((f) => f.severity === Severity.BLOCKER && !f.id.includes("appId"));
        if (blocking.length) {
          return structured(
            ["Credentials are not configured.", ...blocking.map((f) => `- ${f.title}: ${f.fix}`)].join("\n"),
            { configured: false, findings: blocking },
          );
        }
        const apps = await ctx.client.all("/v1/apps?fields[apps]=name,bundleId,sku", { limit: 200 });
        const q = args.query?.toLowerCase();
        const matched = apps
          .map((a) => ({ id: a.id, name: a.attributes.name, bundleId: a.attributes.bundleId, sku: a.attributes.sku }))
          .filter((a) => !q || a.name?.toLowerCase().includes(q) || a.bundleId?.toLowerCase().includes(q));
        const text = matched.length
          ? [
              "| app id | name | bundle id |",
              "| --- | --- | --- |",
              ...matched.map((a) => `| ${a.id} | ${a.name} | ${a.bundleId} |`),
            ].join("\n")
          : "No apps matched.";
        return structured(text, { apps: matched });
      },
    },

    {
      name: "asc_validate_config",
      title: "Validate a config",
      description:
        "Check a config against the schema and against the rules Apple enforces but does not document — " +
        "emoji in the description, over-length keywords, whatsNew on a first version. " +
        "Touches no network and needs no credentials, so it is safe to call while drafting.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        config: z.record(z.string(), z.unknown()).optional().describe("The config object itself."),
        configPath: z.string().optional().describe("Or a path to read it from."),
      },
      async run(args) {
        let config = args.config ?? null;
        if (!config) {
          const path = args.configPath ?? findConfigPath({ env });
          if (!path) {
            return structured("No config given and none found on disk.", { valid: false, findings: [] });
          }
          ({ config } = loadConfig(path));
        }
        const { valid, findings } = validateConfig(config);
        const text = valid
          ? "Valid. Nothing in this config will be rejected by App Store Connect for shape or content."
          : ["Problems found:", "", ...findings.map((f) => `- **${f.title}** — ${f.fix}`)].join("\n");
        return structured(text, { valid, findings });
      },
    },

    {
      name: "asc_plan_release",
      title: "Plan the listing pipeline",
      description:
        "Dry-run the whole listing pipeline and return the exact changes it would send to App Store Connect. " +
        "Writes nothing. Call this before asc_apply_release so the human can see the diff first.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        appId,
        configPath,
        only: z
          .array(z.string())
          .optional()
          .describe(`Subset of: ${PIPELINE.join(", ")}`),
      },
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal({ ...args, dryRun: true }, env);
        if (refusal) return refusal;
        const ids = args.only?.length ? args.only : PIPELINE;
        const { results, changes } = await runPipeline(ids, ctx);
        const text = [
          `# Plan (${changes.length} change${changes.length === 1 ? "" : "s"}, nothing sent)`,
          "",
          summarizeResults(results),
          "",
          changes.length ? "## Would change" : "No changes needed — everything already matches the config.",
          ...changes.map((c) => `- ${c.action} ${c.resource}`),
        ].join("\n");
        return structured(text, { dryRun: true, results, changes });
      },
    },

    {
      name: "asc_open_next_version",
      title: "Open the next version",
      description:
        "Create the next App Store version, so its listing can be prepared. Needed whenever every existing " +
        "version is already live — asc_readiness_report reports that as version.none. A no-op when a version " +
        "is already editable, so it is safe to call first.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        appId,
        configPath,
        version: z
          .string()
          .optional()
          .describe("Version string, e.g. 1.2.0. Inferred from the newest existing one if omitted."),
        confirm,
      },
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const res = await runOperation("new-version", ctx, { version: args.version });
        return structured(`${res.status.toUpperCase()} — ${res.message}`, res);
      },
    },

    {
      name: "asc_apply_release",
      title: "Apply the listing pipeline",
      description:
        "Write the listing to App Store Connect: build attach, metadata, pricing, content rights, age rating, " +
        "category, review info, screenshots and subscription. Idempotent — re-running when everything already " +
        "matches sends nothing. Does not submit for review.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        appId,
        configPath,
        only: z
          .array(z.string())
          .optional()
          .describe(`Subset of: ${PIPELINE.join(", ")}`),
        confirm,
      },
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const ids = args.only?.length ? args.only : PIPELINE;
        const { results, changes } = await runPipeline(ids, ctx);
        const report = await getReadinessReport(ctx);
        const text = [`# Applied`, "", summarizeResults(results), "", renderReportMarkdown(report)].join("\n");
        return structured(text, { results, changes, report });
      },
    },

    {
      name: "asc_upload_screenshots",
      title: "Upload screenshots",
      description:
        "Upload the PNGs in the configured directory to the version's screenshot set. " +
        "Deletes remote screenshots that have no local counterpart only when prune is true, which it is not by default.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        appId,
        configPath,
        displayType: z.string().optional().describe("Override config.screenshots.displayType."),
        // The CLI prunes by default because the human typed the command; a model
        // should not discover deletion by omitting an argument.
        prune: z.boolean().optional().default(false).describe("Delete remote screenshots with no local counterpart."),
        confirm,
      },
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const res = await runOperation("screenshots", ctx, { displayType: args.displayType, prune: args.prune });
        return structured(`${res.status.toUpperCase()} — ${res.message}`, res);
      },
    },

    {
      name: "asc_configure_subscription",
      title: "Configure a subscription",
      description:
        "Write a subscription's localizations, price and App Review paywall screenshot, so it leaves " +
        "MISSING_METADATA. Attaching a first subscription to a version still cannot be done through the API.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: { appId, configPath, confirm },
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const res = await runOperation("subscription", ctx);
        return structured(`${res.status.toUpperCase()} — ${res.message}`, res);
      },
    },

    {
      name: "asc_submit_for_review",
      title: "Submit for review",
      description:
        "Submit the app version to App Review. This is the irreversible one. It computes the readiness report " +
        "first and refuses if anything is blocking, unless force is set.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        appId,
        configPath,
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe("Submit even though blockers remain. Apple will reject it."),
        confirm,
      },
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;

        // The guardrail a generic API wrapper structurally cannot offer: we know
        // what "ready" means, so we can decline to waste a review cycle.
        const report = await getReadinessReport(ctx);
        if (report.verdict !== "ready" && !args.force) {
          return structured(
            [
              `Refusing to submit: the readiness verdict is **${report.verdict}**.`,
              "",
              renderReportMarkdown(report),
              "",
              "Fix the blockers, or call again with force: true to submit anyway (Apple will reject it).",
            ].join("\n"),
            { submitted: false, verdict: report.verdict, report },
          );
        }

        const res = await runOperation("submit", ctx, { submit: true });
        return structured(`${res.status.toUpperCase()} — ${res.message}`, { submitted: true, result: res, report });
      },
    },

    {
      name: "asc_generate_credentials",
      title: "Generate iOS distribution credentials",
      description:
        "Issue a new distribution certificate and provisioning profile and write them to disk. " +
        "Apple caps an account at three distribution certificates and this consumes one. " +
        "Disabled unless the operator sets APPSTORE_RELEASE_ALLOW_LOCAL_WRITES=1.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: { appId, configPath, confirm },
      async run(args) {
        if (!allowLocalWrites) {
          return needsConfirmation(
            "Writing a private key, a .p12 and its password to disk on a model's initiative is an operator decision.",
            "Set APPSTORE_RELEASE_ALLOW_LOCAL_WRITES=1 in this MCP server's environment to enable it, " +
              "or run `appstore-release credentials` yourself.",
          );
        }
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const res = await runOperation("credentials", ctx);
        return structured(`${res.status.toUpperCase()} — ${res.message}`, res);
      },
    },
  ];
}

export { needsConfirmation, structured };
