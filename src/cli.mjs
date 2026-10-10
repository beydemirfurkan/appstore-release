#!/usr/bin/env node
// Single entrypoint / dispatcher.
//
//   appstore-release status              read-only overview
//   appstore-release check               readiness report (what's missing + manual steps)
//   appstore-release release             run the whole listing pipeline, then check
//   appstore-release <operation>         run one operation (metadata, pricing, ...)
//   appstore-release submit --submit     submit the app version for review
//
// Credentials come from ASC_KEY_ID, ASC_ISSUER_ID, ASC_P8_PATH (or ASC_P8),
// ASC_APP_ID, or from the matching flags.

import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createContext } from "./core/context.mjs";
import { Status, Exit } from "./core/status.mjs";
import { Severity } from "./core/findings.mjs";
import { runOperation, runPipeline } from "./index.mjs";
import { OPERATIONS, PIPELINE, getOperation, operationIds } from "./ops/registry.mjs";
import { parseArgs, splitFlags, kebab, GLOBAL_FLAGS, UsageError } from "./cli/args.mjs";
import { createTextSink, renderFindings } from "./cli/render.mjs";
import { createStyle } from "./cli/style.mjs";
import { schemaCommand, initCommand, validateCommand } from "./cli/local.mjs";
import { buildTools } from "./mcp/tools.mjs";
import { RESOURCES } from "./mcp/resources.mjs";
import { doctorCommand } from "./cli/doctor.mjs";

const version = createRequire(import.meta.url)("../package.json").version;

// Counted rather than written down, so the help text cannot drift from reality.
const MCP_TOOL_COUNT = buildTools({ env: {} }).length;

/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : String(e));

/**
 * Run the CLI. Returns an exit code rather than calling process.exit, so the
 * dispatcher is importable from tests and reusable from other entrypoints.
 *
 * @param {string[]} [argv]
 * @param {{ stdout?: any, stderr?: any, env?: any, cwd?: string, fetchImpl?: typeof fetch }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();

  // Parse twice: a lenient pass to learn the command, then a strict one with that
  // operation's own flags in the spec, so `--build 5` is accepted for attach-build
  // and rejected elsewhere. The first pass must not reject what it cannot know yet.
  let parsed;
  try {
    const command = parseArgs(argv, {}, { lenient: true }).command;
    const op = command ? getOperation(command) : null;
    parsed = parseArgs(argv, op?.meta.args ?? {});
    if (op && parsed.positionals.length) {
      // An operation may name one positional (`new-version 1.2.0`); anything else
      // is a mistake worth stopping for rather than silently ignoring.
      const slot = op.meta.positional;
      if (!slot || parsed.positionals.length > 1) {
        throw new UsageError(`Unexpected argument: ${parsed.positionals[slot ? 1 : 0]}`);
      }
      if (parsed.flags[slot] === undefined) parsed.flags[slot] = parsed.positionals[0];
    }
  } catch (e) {
    if (e instanceof UsageError) {
      stderr.write(`${e.message}\n\n`);
      writeHelp(stderr);
      return Exit.USAGE;
    }
    throw e;
  }

  const { command, flags } = parsed;
  // `true`, not truthy: new-version declares its own string `version` argument.
  if (flags.version === true) {
    stdout.write(`${version}\n`);
    return Exit.OK;
  }
  if (flags.help || command === "help" || command === null) {
    const topic = command === "help" ? parsed.positionals[0] : command;
    const op = topic ? getOperation(topic) : null;
    if (op && topic) writeOperationHelp(stdout, topic, op);
    else writeHelp(stdout);
    return Exit.OK;
  }

  // Local commands run before any context is built — they exist precisely for
  // the case where there are no credentials yet.
  if (command === "schema") return schemaCommand(stdout);
  if (command === "init") return initCommand({ stdout, stderr, cwd, target: parsed.positionals[0] });
  if (command === "validate") return validateCommand({ stdout, stderr, cwd, env, explicit: flags.config });
  if (command === "doctor") {
    return doctorCommand({ stdout, stderr, env, cwd, config: flags.config, appId: flags["app-id"] });
  }
  if (command === "mcp") {
    // Hand the process to the MCP server; it owns stdio from here.
    const { main: mcpMain } = await import("./mcp/server.mjs");
    await mcpMain();
    return Exit.OK;
  }

  const isPipeline = command === "release";
  if (!isPipeline && !getOperation(command)) {
    stderr.write(`Unknown command: ${command}\n\n`);
    writeHelp(stderr);
    return Exit.USAGE;
  }

  const opFlags = isPipeline ? {} : (getOperation(command)?.meta.args ?? {});
  const { globals, opArgs } = splitFlags(flags, opFlags);

  // Under --json, stdout carries exactly one JSON document and nothing else;
  // every human-readable byte goes to stderr. That is what makes `| jq` work.
  const humanStream = globals.json ? stderr : stdout;
  const sink = createTextSink(humanStream, {
    verbose: globals.verbose,
    quiet: globals.quiet,
    style: createStyle(humanStream, env),
  });

  let ctx;
  try {
    ctx = await createContext({
      credentials: {
        keyId: globals.keyId,
        issuerId: globals.issuerId,
        privateKeyPath: globals.p8,
        appId: globals.appId,
      },
      config: globals.config,
      projectRoot: globals.projectRoot,
      dryRun: globals.dryRun,
      onEvent: sink,
      fetchImpl: io.fetchImpl,
      runtime: { env, cwd },
    });
  } catch (e) {
    stderr.write(`✗ ${messageOf(e)}\n`);
    return Exit.CONFIG;
  }

  // Credentials are reported as findings, not thrown, so we can print everything
  // that is missing at once instead of one environment variable per run. This is
  // a failure to start, so it goes to stderr whether or not --json was asked for.
  if (ctx.findings.some((f) => f.severity === Severity.BLOCKER)) {
    renderFindings(stderr, ctx.findings);
    if (globals.json) writeJson(stdout, { ok: false, results: [], findings: ctx.findings, changes: [] });
    return globals.exitZero ? Exit.OK : Exit.CONFIG;
  }

  if (globals.dryRun) ctx.log.info("dry run — no changes will be sent to App Store Connect");

  if (isPipeline) {
    ctx.log.section("Release");
    await runPipeline(PIPELINE, ctx);
    // The ten steps above already say what happened; the report after them
    // only needs the verdict and what is left.
    await runOperation("check", ctx, { compact: true });
  } else {
    await runOperation(command, ctx, opArgs);
  }

  const results = ctx.log.results();
  const findings = [...ctx.findings, ...results.flatMap((r) => r.findings ?? [])];

  // The readiness report already printed its findings and its plan; printing
  // them again underneath is noise. Everything else an operation found still shows.
  const reported = new Set(results.filter((r) => r.id === "check").flatMap((r) => (r.findings ?? []).map((f) => f.id)));
  const manual = results.filter((r) => r.status === Status.MANUAL && r.id !== "check");
  if (manual.length) {
    ctx.log.section("Manual steps required (Apple has no API for these)");
    manual.forEach((m, i) => ctx.log.info(`${i + 1}. ${m.title} — ${m.message}`));
  }
  renderFindings(
    humanStream,
    findings.filter((f) => !reported.has(f.id)),
  );

  const code = exitCodeFor(results, findings);
  if (globals.json) {
    writeJson(stdout, {
      ok: code === Exit.OK,
      dryRun: Boolean(globals.dryRun),
      results,
      findings,
      changes: ctx.log.changes(),
    });
  }
  return globals.exitZero ? Exit.OK : code;
}

/**
 * Exit 4 means "there is still something this tool can do about it"; exit 5 means
 * "there is not". That distinction is the whole reason for the code table.
 *
 * @param {import("./core/events.mjs").OperationResult[]} results
 * @param {import("./core/findings.mjs").Finding[]} findings
 */
function exitCodeFor(results, findings) {
  if (results.some((r) => r.status === Status.ERROR)) return Exit.BLOCKED;
  const blocking = findings.filter((f) => f.severity === Severity.BLOCKER);
  if (blocking.some((f) => !f.uiOnly)) return Exit.BLOCKED;
  if (blocking.length || results.some((r) => r.status === Status.MANUAL)) return Exit.NEEDS_HUMAN;
  return Exit.OK;
}

function writeJson(stream, payload) {
  stream.write(JSON.stringify(payload, null, 2) + "\n");
}

/**
 * `appstore-release <command> --help`: the operation's own flags, which the
 * general help cannot list without becoming a wall of text.
 *
 * @param {any} stream
 * @param {string} id
 * @param {import("./ops/registry.mjs").Operation} op
 */
function writeOperationHelp(stream, id, op) {
  const usage = op.meta.positional ? `${id} [${op.meta.positional}]` : id;
  const own = Object.entries(op.meta.args ?? {})
    .map(([name, def]) => {
      const label = def.type === "boolean" ? `--${kebab(name)}` : `--${kebab(name)} <${def.type}>`;
      return `  ${label.padEnd(24)} ${def.description}`;
    })
    .join("\n");
  const notes = [op.meta.mutates ? "changes App Store Connect (preview with --dry-run)" : "read-only"];
  if (op.meta.destructive) notes.push("can delete existing data");
  if (op.meta.irreversible) notes.push("cannot be undone");
  stream.write(
    `appstore-release ${usage} — ${op.meta.title}\n` +
      `${notes.join(" · ")}\n\n` +
      (own ? `Options\n${own}\n\n` : "") +
      `Global options: appstore-release --help\n`,
  );
}

function writeHelp(stream) {
  const ops = operationIds()
    .map((id) => `  ${id.padEnd(16)} ${OPERATIONS[id].meta.title}`)
    .join("\n");
  const flags = Object.entries(GLOBAL_FLAGS)
    .map(([name, def]) => {
      const label = def.alias ? `-${def.alias}, --${name}` : `--${name}`;
      return `  ${label.padEnd(20)} ${def.description}`;
    })
    .join("\n");

  stream.write(
    `appstore-release ${version}\n` +
      `Ship an iOS app to App Store review, end to end, over the App Store Connect API.\n\n` +
      `Usage: appstore-release <command> [options]\n\n` +
      `Commands\n` +
      `  init             scaffold appstore.config.json (no credentials needed)\n` +
      `  schema           print the config JSON Schema\n` +
      `  validate         check the config offline\n` +
      `  doctor           verify credentials, tools and config; touches no app data\n` +
      `  mcp              run the MCP server on stdio (${MCP_TOOL_COUNT} tools, ${RESOURCES.length} resources)\n` +
      `  release          the ${PIPELINE.length}-step listing pipeline, then a readiness check\n` +
      `${ops}\n\n` +
      `Run \`appstore-release <command> --help\` for a command's own options.\n\n` +
      `Options\n${flags}\n\n` +
      `Exit codes\n` +
      `  0 ok · 2 usage · 3 config/credentials · 4 blocked (fixable) · 5 needs a human in App Store Connect\n`,
  );
}

// Only run when invoked as a program, so tests and the MCP server can import main().
// argv[1] is npm's bin symlink, import.meta.url is the real file — resolve before comparing.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    process.exitCode = await main();
  } catch (e) {
    console.error(`\n✗ ${messageOf(e)}`);
    process.exitCode = Exit.INTERNAL;
  }
}
