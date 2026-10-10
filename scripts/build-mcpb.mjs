#!/usr/bin/env node
// Package the MCP server as an MCPB bundle (dist/appstore-release.mcpb) and write
// the MCP Registry's server.json next to it. This is how the server reaches the
// registry without an npm package: the registry accepts an .mcpb hosted on a
// GitHub release, pinned by its SHA-256.
//
//   node scripts/build-mcpb.mjs
//
// The release workflow runs this, uploads both files to the GitHub release, and
// publishes server.json to registry.modelcontextprotocol.io.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTools } from "../src/mcp/tools.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");
const STAGE = join(OUT, "mcpb");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const REPO = "https://github.com/beydemirfurkan/appstore-release";
const NAME = "io.github.beydemirfurkan/appstore-release";
const BUNDLE = "appstore-release.mcpb";

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
// What the server needs at runtime: its code, the schema it validates against,
// the skills it serves as resources, and package.json for its version.
for (const entry of ["src", "schemas", "skills", "package.json", "LICENSE"]) {
  cpSync(join(ROOT, entry), join(STAGE, entry), { recursive: true });
}

const userConfig = {
  asc_key_id: {
    type: "string",
    title: "Key ID",
    description: "App Store Connect API key id (10 characters).",
    required: true,
  },
  asc_issuer_id: {
    type: "string",
    title: "Issuer ID",
    description: "The issuer id shown above the key list.",
    required: true,
  },
  asc_p8_path: {
    type: "file",
    title: "Private key (.p8)",
    description: "The AuthKey_XXXXXXXXXX.p8 you downloaded.",
    required: true,
  },
  asc_app_id: {
    type: "string",
    title: "App id",
    description: "The digits in the App Store Connect URL of your app.",
    required: false,
  },
  appstore_config: {
    type: "file",
    title: "Config file",
    description: "Your appstore.config.json. Optional; tools also accept a path.",
    required: false,
  },
};

const manifest = {
  manifest_version: "0.3",
  name: pkg.name,
  display_name: "App Store Release",
  version: pkg.version,
  description:
    "Take an iOS app all the way to App Store review: readiness report, idempotent listing pipeline, submit.",
  long_description:
    "Outcome-shaped tools over the App Store Connect API. Start with asc_readiness_report: it returns a verdict and an " +
    "ordered plan, and says for every finding whether this server can fix it or only App Store Connect's UI can. " +
    "Every write needs confirm: true; submit refuses unless the report is ready. Credentials come from the " +
    "environment only, never from tool arguments.",
  author: { name: "Furkan Beydemir", url: "https://github.com/beydemirfurkan" },
  repository: { type: "git", url: `${REPO}.git` },
  homepage: REPO,
  support: `${REPO}/issues`,
  license: pkg.license,
  keywords: ["app-store", "app-store-connect", "ios", "submission", "release"],
  server: {
    type: "node",
    entry_point: "src/mcp/server.mjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/src/mcp/server.mjs"],
      env: {
        ASC_KEY_ID: "${user_config.asc_key_id}",
        ASC_ISSUER_ID: "${user_config.asc_issuer_id}",
        ASC_P8_PATH: "${user_config.asc_p8_path}",
        ASC_APP_ID: "${user_config.asc_app_id}",
        APPSTORE_CONFIG: "${user_config.appstore_config}",
      },
    },
  },
  tools: buildTools({ env: {} }).map((t) => ({ name: t.name, description: t.description.split(". ")[0] })),
  user_config: userConfig,
  compatibility: { platforms: ["darwin", "linux", "win32"], runtimes: { node: pkg.engines.node } },
};
writeFileSync(join(STAGE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Deterministic: fixed mtimes and a sorted file list, so the same tree gives the
// same bytes and the same SHA-256 on any machine with the same zip.
const files = walk(STAGE).sort();
const epoch = new Date("2026-01-01T00:00:00Z");
for (const f of files) utimesSync(f, epoch, epoch);
rmSync(join(OUT, BUNDLE), { force: true });
execFileSync("zip", ["-X", "-D", "-q", "-9", join(OUT, BUNDLE), "-@"], {
  cwd: STAGE,
  input: files.map((f) => relative(STAGE, f)).join("\n"),
});

const sha = createHash("sha256")
  .update(readFileSync(join(OUT, BUNDLE)))
  .digest("hex");
const server = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: NAME,
  title: "App Store Release",
  description: "Ship an iOS app to App Store review: readiness report, idempotent pipeline, submit.",
  repository: { url: REPO, source: "github" },
  version: pkg.version,
  packages: [
    {
      registryType: "mcpb",
      identifier: `${REPO}/releases/download/v${pkg.version}/${BUNDLE}`,
      fileSha256: sha,
      transport: { type: "stdio" },
      environmentVariables: [
        { name: "ASC_KEY_ID", description: "App Store Connect API key id", isRequired: true, isSecret: false },
        { name: "ASC_ISSUER_ID", description: "App Store Connect issuer id", isRequired: true, isSecret: false },
        { name: "ASC_P8_PATH", description: "Path to the AuthKey_*.p8 private key", isRequired: true, isSecret: true },
        { name: "ASC_APP_ID", description: "Numeric App Store Connect app id", isRequired: false, isSecret: false },
      ],
    },
  ],
};
writeFileSync(join(OUT, "server.json"), JSON.stringify(server, null, 2) + "\n");

const size = (statSync(join(OUT, BUNDLE)).size / 1024).toFixed(0);
console.log(`✓ dist/${BUNDLE} (${size} KB, ${files.length} files)\n  sha256 ${sha}\n✓ dist/server.json`);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
