// The tool surface, deliberately small.
//
// npm already has App Store Connect MCP servers advertising 162 and 1293 tools.
// Raw endpoint coverage is not the scarce thing: an agent that can call
// PATCH /v1/appStoreVersionLocalizations still does not know that whatsNew 409s
// on a first version, that emoji in the description is a hard rejection, or that
// the age-rating declaration must be sent complete. Those tools hand the model
// the landmines; these thirteen defuse them.
//
// The count is a product decision with a test behind it. Each tool earns its
// place by being an outcome someone wants, not an API call someone could make.
//
// A tool list is also a per-request tax on every conversation the server is
// attached to, and tool-selection accuracy falls off well before a thousand
// options. There is one job here — get an app through review — and it has one
// shape.

import { createContext } from "../core/context.mjs";
import { runOperation, runPipeline } from "../index.mjs";
import { getAppSnapshot } from "../report/snapshot.mjs";
import { getReadinessReport } from "../report/report.mjs";
import { waitForReview } from "../report/wait.mjs";
import { listReviews, summarize as summarizeReviews, formatReview } from "../ops/reviews.mjs";
import { MAX_REPLY_LENGTH } from "../ops/reply.mjs";
import { REJECTION_FINDINGS } from "../report/checks/review.mjs";
import { renderReportMarkdown } from "../report/render.mjs";
import { validateConfig } from "../core/requirements.mjs";
import { loadConfig, findConfigPath } from "../core/config.mjs";
import { PIPELINE } from "../ops/registry.mjs";
import { Severity } from "../core/findings.mjs";
import { Status, versionState } from "../core/status.mjs";

// Input schemas are plain JSON Schema. That is what goes on the wire anyway —
// zod existed only to be converted into this — and it means the same validator
// that checks a user's config also checks a model's tool arguments.

/** @param {string} description */
const str = (description) => ({ type: "string", description });
/** @param {string} description @param {boolean} [dflt] */
const bool = (description, dflt) => ({
  type: "boolean",
  description,
  ...(dflt === undefined ? {} : { default: dflt }),
});

/**
 * Required on every mutating tool. A literal `true` cannot be produced by
 * accident, and the description tells the host what it is confirming — which
 * turns a mutation into a two-turn handshake the user actually sees.
 */
const confirm = {
  type: "boolean",
  const: true,
  description: "Must be true. Set it only after the human has approved this change to a live App Store listing.",
};

const appId = str("Numeric App Store Connect app id. Defaults to ASC_APP_ID.");
const configPath = str("Path to the config file. Defaults to the usual discovery order.");

// `only` is a subset of the listing pipeline and nothing else: an unchecked list
// would let a model run `credentials` (past its own local-writes gate) or
// `submit` (past its readiness check) through a tool that promises neither.
const pipelineSubset = {
  type: "array",
  items: { type: "string", enum: [...PIPELINE] },
  description: `Subset of: ${PIPELINE.join(", ")}`,
};

/** @param {unknown} only @returns {readonly string[] | string} the ids, or a refusal message */
function pipelineIds(only) {
  if (only === undefined || (Array.isArray(only) && only.length === 0)) return PIPELINE;
  if (!Array.isArray(only)) return "`only` must be an array of pipeline step ids.";
  const unknown = only.filter((id) => !PIPELINE.includes(id));
  if (unknown.length) {
    return `Not pipeline steps: ${unknown.join(", ")}. \`only\` accepts: ${PIPELINE.join(", ")}.`;
  }
  return only;
}

// The CLI prunes orphaned screenshots because a human typed `release`; a model
// should not discover deletion by omitting an argument. Same rule as
// asc_upload_screenshots, applied to the pipeline tools.
const AGENT_PIPELINE_ARGS = Object.freeze({ screenshots: { prune: false } });

/**
 * Assemble a tool's input schema.
 * @param {Record<string, any>} properties
 * @param {string[]} [required]
 */
const input = (properties, required = []) => ({
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

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
 * @property {Record<string, any>} inputSchema           JSON Schema
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
      inputSchema: input({
        appId,
        configPath,
        locale: str("Locale to report on."),
        waitMinutes: {
          type: "number",
          minimum: 0,
          maximum: 15,
          description:
            "After a submission: keep re-checking for up to this many minutes while the version is in review. " +
            "Review usually takes hours; call again later rather than waiting long.",
        },
      }),
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        if (args.waitMinutes > 0) {
          const { report, timedOut, waitedMinutes } = await waitForReview(ctx, {
            minutes: Math.min(args.waitMinutes, 15),
          });
          const note = timedOut ? `\n\nStill in review after ${waitedMinutes} min. Check again later.` : "";
          return structured(renderReportMarkdown(report) + note, { ...report, timedOut, waitedMinutes });
        }
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
      inputSchema: input({ appId, configPath, locale: str("Locale to inspect.") }),
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const snapshot = await getAppSnapshot(ctx, { locale: args.locale });
        const lines = [
          `# ${snapshot.app?.attributes?.name ?? "app"} (${snapshot.app?.attributes?.bundleId ?? "?"})`,
          "",
          `Editable version: ${snapshot.version ? `${snapshot.version.attributes.versionString} (${versionState(snapshot.version)})` : "none"}`,
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
      inputSchema: input({ query: str("Filter by name or bundle id, case-insensitive.") }),
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
      inputSchema: input({
        config: { type: "object", description: "The config object itself." },
        configPath: str("Or a path to read it from."),
      }),
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
      inputSchema: input({
        appId,
        configPath,
        only: pipelineSubset,
      }),
      async run(args) {
        const ids = pipelineIds(args.only);
        if (typeof ids === "string") return structured(ids, { error: ids });
        const { ctx, refusal } = await contextOrRefusal({ ...args, dryRun: true }, env);
        if (refusal) return refusal;
        const { results, changes } = await runPipeline(ids, ctx, { args: AGENT_PIPELINE_ARGS });
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
      inputSchema: input(
        {
          appId,
          configPath,
          version: str("Version string, e.g. 1.2.0. Inferred from the newest existing one if omitted."),
          confirm,
        },
        ["confirm"],
      ),
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
      inputSchema: input(
        {
          appId,
          configPath,
          only: pipelineSubset,
          confirm,
        },
        ["confirm"],
      ),
      async run(args) {
        const ids = pipelineIds(args.only);
        if (typeof ids === "string") return structured(ids, { error: ids });
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const { results, changes } = await runPipeline(ids, ctx, { args: AGENT_PIPELINE_ARGS });
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
      inputSchema: input(
        {
          appId,
          configPath,
          displayType: str("Override config.screenshots.displayType."),
          // The CLI prunes by default because the human typed the command; a model
          // should not discover deletion by omitting an argument.
          prune: bool("Delete remote screenshots with no local counterpart.", false),
          confirm,
        },
        ["confirm"],
      ),
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const res = await runOperation("screenshots", ctx, { displayType: args.displayType, prune: args.prune });
        return structured(`${res.status.toUpperCase()} — ${res.message}`, res);
      },
    },

    {
      name: "asc_configure_subscription",
      title: "Configure subscriptions and in-app purchases",
      description:
        "Create any missing subscription plans and one-time purchases from the config, then write their " +
        "localizations, prices, introductory offers and App Review screenshots, so they leave " +
        "MISSING_METADATA. Once READY_TO_SUBMIT, asc_submit_for_review sends them with the app version — except the " +
        "app's first subscription and first in-app purchase, which Apple requires to be submitted from the website.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: input({ appId, configPath, confirm }, ["confirm"]),
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const subs = await runOperation("subscription", ctx);
        const iaps = await runOperation("in-app-purchases", ctx);
        const text = [subs, iaps].map((r) => `${r.title}: ${r.status.toUpperCase()} — ${r.message}`).join("\n");
        return structured(text, { subscriptions: subs, inAppPurchases: iaps });
      },
    },

    {
      name: "asc_submit_for_review",
      title: "Submit for review",
      description:
        "Submit the app version to App Review. This is the irreversible one. It computes the readiness report " +
        "first and refuses if anything is blocking, unless force is set.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: input(
        {
          appId,
          configPath,
          force: bool("Submit even though blockers remain. Apple will reject it.", false),
          resolved: bool(
            "After a rejection: the user has addressed what App Review asked for in Resolution Center. Resubmits.",
            false,
          ),
          confirm,
        },
        ["confirm"],
      ),
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;

        // The guardrail a generic API wrapper structurally cannot offer: we know
        // what "ready" means, so we can decline to waste a review cycle.
        const report = await getReadinessReport(ctx);
        const resubmit =
          report.verdict === "rejected" &&
          args.resolved &&
          !report.findings.some((f) => f.severity === "blocker" && !REJECTION_FINDINGS.includes(f.id));
        if (report.verdict !== "ready" && !args.force && !resubmit) {
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

        const res = await runOperation("submit", ctx, {
          submit: true,
          force: Boolean(args.force),
          resolved: Boolean(args.resolved),
        });
        // Only a CHANGED result means the PATCH went through; an OK can be "already
        // in review" and an ERROR is a refusal — neither is a submission.
        const submitted = res.status === Status.CHANGED;
        return structured(`${res.status.toUpperCase()} — ${res.message}`, { submitted, result: res, report });
      },
    },

    {
      name: "asc_customer_reviews",
      title: "Customer reviews",
      description:
        "Read the app's customer reviews, newest first: rating, title, text, territory, and any published reply. " +
        "Filter to what needs attention — low ratings, unanswered ones — and optionally include Apple's own " +
        "summary of recent reviews. Read-only. To answer one, draft a reply, show it to the human, and only " +
        "after they approve it call asc_reply_to_review.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: input({
        appId,
        rating: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 5 },
          description: "Only these star ratings, e.g. [1, 2].",
        },
        unanswered: bool("Only reviews without a published reply.", false),
        territory: str("Only reviews from this territory, e.g. USA."),
        limit: { type: "integer", minimum: 1, maximum: 200, description: "How many, newest first. Default 20." },
        summary: bool("Also return Apple's summary of recent reviews.", false),
      }),
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const reviews = await listReviews(ctx, args);
        const summaries = args.summary ? await summarizeReviews(ctx) : [];
        const lines = [
          `# ${reviews.length} review${reviews.length === 1 ? "" : "s"}`,
          "",
          ...reviews.map((r) => `- ${formatReview(r)}`),
          ...(summaries.length ? ["", "## Apple's summary", ...summaries.map((s) => `- (${s.locale}) ${s.text}`)] : []),
        ];
        return structured(lines.join("\n"), { reviews, summaries });
      },
    },

    {
      name: "asc_reply_to_review",
      title: "Reply to a customer review",
      description:
        "Publish a reply to one customer review on the App Store — publicly, under the developer's name. Replying " +
        "again replaces the previous reply; the same text twice changes nothing. Draft the reply in the review's " +
        "language, show the exact text to the human, and call this only once they approve that text. Never reply " +
        "in bulk without approval of each reply.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: input(
        {
          appId,
          reviewId: str("The review id, from asc_customer_reviews."),
          text: { type: "string", maxLength: MAX_REPLY_LENGTH, description: "The reply exactly as approved." },
          delete: bool("Remove the published reply instead of writing one.", false),
          confirm,
        },
        ["reviewId", "confirm"],
      ),
      async run(args) {
        const { ctx, refusal } = await contextOrRefusal(args, env);
        if (refusal) return refusal;
        const res = await runOperation("reply", ctx, { review: args.reviewId, text: args.text, delete: args.delete });
        return structured(`${res.status.toUpperCase()} — ${res.message}`, res);
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
      inputSchema: input({ appId, configPath, confirm }, ["confirm"]),
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
