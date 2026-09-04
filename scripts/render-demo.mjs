#!/usr/bin/env node
// Regenerate docs/demo.png from docs/demo.html. There was previously no way to
// rebuild the image, so it drifted from what the tool actually prints.
//
//   node scripts/render-demo.mjs
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

execFileSync(
  chrome,
  [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    "--window-size=1240,1010",
    `--screenshot=${join(ROOT, "docs/demo.png")}`,
    `file://${join(ROOT, "docs/demo.html")}`,
  ],
  { stdio: "inherit" },
);
console.log("✓ docs/demo.png");
