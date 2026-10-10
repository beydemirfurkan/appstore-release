#!/usr/bin/env node
// Render the promo video in both cuts, plus the README poster and GIF teaser.
//
//   node docs/media/video/render.mjs            16:9 + 1:1 + poster + teaser (standard quality)
//   node docs/media/video/render.mjs --draft    faster, lower quality
//
// Outputs land in dist/media/ (gitignored); the poster and teaser are written
// into docs/media/ because the README embeds them. The 1:1 cut is the same
// composition with a smaller unit (--u) and stacked layout (body.square), so
// the two can never tell different stories.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const OUT = join(ROOT, "dist", "media");
const quality = process.argv.includes("--draft") ? "draft" : "standard";

mkdirSync(OUT, { recursive: true });

const render = (cwd, output) =>
  execFileSync("npx", ["--yes", "hyperframes@0.8.145", "render", "--quality", quality, "--output", output], {
    cwd,
    stdio: "inherit",
  });
const ffmpeg = (args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });

// 16:9
const wide = join(OUT, "appstore-release-promo.mp4");
render(HERE, wide);

// 1:1 — a throwaway copy with the frame and unit swapped.
const squareDir = join(OUT, "square-src");
rmSync(squareDir, { recursive: true, force: true });
cpSync(HERE, squareDir, {
  recursive: true,
  filter: (src) => !/node_modules|\.hyperframes|renders/.test(src),
});
const html = readFileSync(join(HERE, "index.html"), "utf8")
  .replace("--W: 1920px;", "--W: 1080px;")
  .replace("--H: 1080px;", "--H: 1080px;")
  .replace("--u: 1px;", "--u: 0.8px;")
  .replace('content="width=1920, height=1080"', 'content="width=1080, height=1080"')
  .replace('data-width="1920"', 'data-width="1080"')
  .replace("<body>", '<body class="square">');
writeFileSync(join(squareDir, "index.html"), html);
render(squareDir, join(OUT, "appstore-release-promo-square.mp4"));

// Poster: the end state of the readiness report — the frame that explains the product.
ffmpeg([
  "-ss",
  "20.4",
  "-i",
  wide,
  "-frames:v",
  "1",
  "-vf",
  "scale=1280:-1",
  join(ROOT, "docs", "media", "video-poster.png"),
]);

// Teaser GIF: report flip → pipeline, 8s, 960px, palette-optimised.
const palette = join(OUT, "palette.png");
const clip = ["-ss", "14.6", "-t", "8"];
const filters = "fps=12,scale=960:-1:flags=lanczos";
ffmpeg([...clip, "-i", wide, "-vf", `${filters},palettegen=max_colors=96:stats_mode=diff`, palette]);
ffmpeg([
  ...clip,
  "-i",
  wide,
  "-i",
  palette,
  "-lavfi",
  `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  join(ROOT, "docs", "media", "promo-teaser.gif"),
]);

console.log(`✓ ${OUT}/appstore-release-promo.mp4`);
console.log(`✓ ${OUT}/appstore-release-promo-square.mp4`);
console.log("✓ docs/media/video-poster.png");
console.log("✓ docs/media/promo-teaser.gif");
