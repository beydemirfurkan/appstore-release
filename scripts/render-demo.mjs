#!/usr/bin/env node
// Regenerate the images in docs/ from their HTML sources. There was previously
// no way to rebuild demo.png, so it drifted from what the tool actually prints.
//
//   node scripts/render-demo.mjs                 both
//   node scripts/render-demo.mjs demo            just the terminal shot
//   node scripts/render-demo.mjs social          just the GitHub social preview
//
// Needs Chrome. Falls back through the usual install locations.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {string[]} */
const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
].filter((c) => typeof c === "string");

// An absolute path must exist; a bare name is left to PATH resolution.
const chrome = CANDIDATES.find((c) => !c.includes("/") || existsSync(c));
if (!chrome) {
  console.error("No Chrome found. Set CHROME_PATH.");
  process.exit(1);
}

/** GitHub renders the social preview at 1280x640; the demo is its own shape. */
const TARGETS = {
  demo: { html: "docs/demo.html", png: "docs/demo.png", width: 1240, height: 1010, scale: 2 },
  // Rendered 1:1: GitHub scales it down anyway, and a 2x file is needlessly large.
  social: { html: "docs/social-preview.html", png: "docs/social-preview.png", width: 1280, height: 640, scale: 1 },
};

const wanted = process.argv.slice(2).filter((a) => a in TARGETS);
for (const name of wanted.length ? wanted : Object.keys(TARGETS)) {
  const t = TARGETS[name];
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      `--force-device-scale-factor=${t.scale}`,
      `--window-size=${t.width},${t.height}`,
      `--screenshot=${join(ROOT, t.png)}`,
      `file://${join(ROOT, t.html)}`,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  console.log(`✓ ${t.png}`);
}
