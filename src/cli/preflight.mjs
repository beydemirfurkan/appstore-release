// `appstore-release preflight`: read the app itself — Info.plist, privacy
// manifest, config and code — and say what App Review is likely to reject. No
// credentials, no network; the only thing it ever runs is `npx expo config`,
// and only when asked with --expo-config.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Exit } from "../core/status.mjs";
import { Severity } from "../core/findings.mjs";
import { findConfigPath, loadConfig } from "../core/config.mjs";
import { runPreflight } from "../preflight/index.mjs";
import { createStyle } from "./style.mjs";

/** Flags of this command, beside the global ones (`--project-root`, `--config`, `--json`, `--exit-zero`). */
export const PREFLIGHT_FLAGS = Object.freeze({
  "expo-config": {
    type: /** @type {const} */ ("boolean"),
    description: "evaluate app.config.js/ts with `npx expo config` (runs the project's config code)",
  },
});

/**
 * @param {{ stdout: any, stderr: any, cwd: string, env: Record<string, string|undefined>, flags: Record<string, any> }} io
 * @returns {number}
 */
export function preflightCommand({ stdout, stderr, cwd, env, flags }) {
  const configPath = findConfigPath({ explicit: flags.config, env, cwd });
  let config = null;
  if (configPath) {
    try {
      ({ config } = loadConfig(configPath));
    } catch (e) {
      stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`);
      return Exit.CONFIG;
    }
  }
  const projectDir = flags["project-root"]
    ? resolve(cwd, flags["project-root"])
    : configPath
      ? dirname(configPath)
      : cwd;

  if (!isDirectory(projectDir)) {
    stderr.write(`✗ ${projectDir} is not a directory\n`);
    return Exit.USAGE;
  }

  let expoConfig;
  if (flags["expo-config"]) {
    try {
      const out = execFileSync("npx", ["expo", "config", "--type", "public", "--json"], {
        cwd: projectDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
      expoConfig = JSON.parse(out);
    } catch (e) {
      stderr.write(`✗ npx expo config failed in ${projectDir}: ${e instanceof Error ? e.message.split("\n")[0] : e}\n`);
      return Exit.CONFIG;
    }
  }

  const result = runPreflight({ projectDir, config, expoConfig });
  const blockers = result.findings.filter((f) => f.severity === Severity.BLOCKER);
  const code = flags["exit-zero"] ? Exit.OK : blockers.length ? Exit.BLOCKED : Exit.OK;

  if (flags.json) {
    stdout.write(JSON.stringify({ ok: !blockers.length, ...result }, null, 2) + "\n");
    return code;
  }
  stdout.write(renderPreflightText(result, createStyle(stdout, env)) + "\n");
  return code;
}

/**
 * @param {import("../preflight/index.mjs").PreflightResult} result
 * @param {import("./style.mjs").Style} s
 */
export function renderPreflightText(result, s) {
  const lines = [""];
  const kind = { expo: "Expo (managed)", "expo-prebuilt": "Expo with ios/", native: "Xcode project" }[
    result.kind ?? ""
  ];
  lines.push(`${s.bold("App preflight")} ${s.dim(`${kind ?? "no app found"} · ${result.projectDir}`)}`);

  /** @type {Array<{ severity: string, paint: (t: string) => string, mark: string, heading: string }>} */
  const groups = [
    { severity: Severity.BLOCKER, paint: s.red, mark: "✗", heading: "Will be rejected" },
    { severity: Severity.WARNING, paint: s.yellow, mark: "!", heading: "Likely to be questioned" },
    { severity: Severity.INFO, paint: s.dim, mark: "·", heading: "Worth knowing" },
  ];
  for (const { severity, paint, mark, heading } of groups) {
    const list = result.findings.filter((f) => f.severity === severity);
    if (!list.length) continue;
    lines.push("", paint(`${heading} (${list.length})`));
    for (const f of list) {
      const where = f.location ? `${f.location.file}${f.location.line ? `:${f.location.line}` : ""}` : "";
      // The id is what `preflight.ignore` takes, so it is shown wherever a waiver could follow.
      const tags = [severity === Severity.INFO ? "" : f.id, f.guideline ? `Guideline ${f.guideline}` : "", where]
        .filter(Boolean)
        .join(" · ");
      lines.push(`  ${paint(mark)} ${f.title}`);
      if (tags) lines.push(`    ${s.dim(tags)}`);
      if (severity !== Severity.INFO) lines.push(`    ${s.dim(`fix: ${f.fix}`)}`);
    }
  }

  if (result.manualChecks.length) {
    lines.push("", s.bold("Test on a device"), s.dim("  a static read cannot prove these work"));
    for (const m of result.manualChecks) lines.push(`  □ ${m}`);
  }
  if (result.notes.length) {
    lines.push("", s.dim("Not read"), ...result.notes.map((n) => s.dim(`  ${n}`)));
  }

  const blockers = result.findings.filter((f) => f.severity === Severity.BLOCKER).length;
  const warnings = result.findings.filter((f) => f.severity === Severity.WARNING).length;
  lines.push(
    "",
    blockers
      ? s.red(s.bold(`✗ ${blockers} certain rejection${blockers === 1 ? "" : "s"}`)) +
          (warnings ? s.dim(` · ${warnings} to look at`) : "")
      : result.found
        ? s.green(s.bold("✓ nothing certain to be rejected")) + (warnings ? s.dim(` · ${warnings} to look at`) : "")
        : s.dim("Nothing checked."),
  );
  if (warnings)
    lines.push(
      s.dim('  Not a problem? Waive it with a reason: "preflight": { "ignore": [{ "id": "…", "reason": "…" }] }'),
    );
  return lines.join("\n");
}

/** @param {string} path */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
