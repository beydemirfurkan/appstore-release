#!/usr/bin/env node
// Rebuild every image and recording the README uses, from sources in this repo.
//
//   node scripts/media.mjs              social preview + terminal GIFs
//   node scripts/media.mjs social       docs/social-preview.png (needs Chrome)
//   node scripts/media.mjs gifs         docs/media/*.gif from docs/media/tapes (needs vhs)
//   node scripts/media.mjs video        dist/media/*.mp4, poster and teaser (needs HyperFrames via npx)
//
// The GIFs are the real CLI, recorded against the fake App Store Connect in
// scripts/demo/ — so they cannot drift from what the tool prints.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (/** @type {string} */ cmd, /** @type {string[]} */ args, quiet = false) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: ["ignore", "ignore", quiet ? "ignore" : "inherit"] });

const TASKS = {
  social() {
    const chrome = [
      process.env.CHROME_PATH,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "google-chrome",
      "chromium",
    ]
      .filter((c) => typeof c === "string")
      .find((c) => !c.includes("/") || existsSync(c));
    if (!chrome) throw new Error("No Chrome found. Set CHROME_PATH.");
    // Rendered 1:1: GitHub shows the social preview at 1280×640 and scales it anyway.
    run(
      chrome,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=1280,640",
        `--screenshot=${join(ROOT, "docs/social-preview.png")}`,
        // pathToFileURL percent-encodes, so a checkout path with spaces still resolves.
        pathToFileURL(join(ROOT, "docs/social-preview.html")).href,
      ],
      true,
    ); // headless Chrome is chatty on stderr about displays it does not have
    return ["docs/social-preview.png"];
  },
  gifs() {
    const tapes = readdirSync(join(ROOT, "docs/media/tapes")).filter((f) => f.endsWith(".tape") && !f.startsWith("_"));
    for (const tape of tapes) run("vhs", [join("docs/media/tapes", tape)]);
    return tapes.map((t) => `docs/media/${t.replace(/\.tape$/, ".gif")}`);
  },
  video() {
    run("node", ["docs/media/video/render.mjs"]);
    return ["dist/media/appstore-release-promo.mp4", "dist/media/appstore-release-promo-square.mp4"];
  },
};

const wanted = process.argv.slice(2).filter((a) => a in TASKS);
for (const name of wanted.length ? wanted : ["social", "gifs"]) {
  for (const out of TASKS[/** @type {keyof typeof TASKS} */ (name)]()) console.log(`✓ ${out}`);
}
