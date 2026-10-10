---
name: app-store-screenshot-upload
description: Produce and upload App Store screenshots at the exact pixel sizes Apple requires — iPhone 6.9", iPhone Duo (foldable, required from April 2027), 13" iPad — through the App Store Connect App Asset Library, with diff-then-upload idempotency. Use when the user says "make App Store screenshots", "upload screenshots", "screenshot sizes", "iPhone Duo screenshots", "iPad screenshots are missing", "wrong screenshot dimensions", or when an App Store readiness check reports screenshots.* findings.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager). Producing images optionally uses the iOS Simulator (macOS) or headless Chrome/Chromium.
metadata:
  author: Furkan Beydemir
  version: "4.3.1"
  guidelines: "2026-06-08"
---

# App Store screenshots

> **You say:** _"Upload my new screenshots, including iPhone Duo."_ · _"Why are my screenshots rejected?"_
>
> **It does:** Checks every PNG against Apple's exact sizes, sorts any exported folder into iPhone, iPad and Duo sets, and uploads through the App Asset Library — re-running sends only what changed.

Two jobs: **produce** images Apple accepts, and **deliver** them to the right device slots without re-uploading what is already there.

## Running the CLI

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from. The launcher finds or fetches the appstore-release CLI (set `APPSTORE_RELEASE_HOME` to use a checkout). Below, `asc` means that line. Credentials come from `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_P8_PATH`, `ASC_APP_ID` — never from arguments.

## 1. Decide which sets the app needs

Ask the user, then pick from [references/sizes.md](references/sizes.md):

- **Every iPhone app:** one 6.9" set — 1320×2868 portrait (1290×2796 and 1260×2736 also accepted). It is scaled down for every smaller iPhone.
- **iPhone Duo:** from April 2027 every submission built with the iOS 27.1 SDK must include it — outer display 1398×2034, inner display 2007×2853 (landscape swaps width and height). Only the App Asset Library can deliver these.
- **iPad:** required when the app supports iPad (`supportsTablet: true`) — 13" at 2064×2752 (or 2048×2732).
- Up to 10 screenshots per device group; at least 1. Three to five strong ones convert better than ten weak ones.

`asc screenshots --list-groups` prints the placement groups Apple offers right now, with their accepted sizes — read it rather than trusting a hard-coded table when a new device ships.

## 2. Produce the images

**What to put on them.** A screenshot is an ad, not documentation. In search results only the first three show, so they carry the decision:

- One idea per screenshot, in a caption of three to five words a line — the benefit, not the feature name.
- Order: the outcome the user wants → what makes the app different → the main features → proof (a rating, a press quote, a number) → a closing call to action.
- Real screens under the caption (guideline 2.3.3). Text in the image is read by Apple's search too, so use the words people search for.
- The same story in every locale: translate the captions, do not just reuse the English images.

If another skill or tool produces the images, point `screenshots.from` at its output folder (step 3) — this skill's part is getting them to Apple at the right sizes.

Rules Apple enforces: exact pixel size, **no alpha channel**, PNG or JPEG, sRGB or P3, and the screenshots must show the real app (guideline 2.3.3 — marketing captions are fine, invented UI is not).

Methods, in order of fidelity — see [references/producing.md](references/producing.md):

1. **Simulator capture** — `xcrun simctl io booted screenshot` on the matching simulator, optionally framed and captioned.
2. **HTML mockup → headless Chrome** — recreate the real screens faithfully with a caption; render at exact size.
3. **Device capture** from a physical device of the right size.

Check the files before anything is sent — `--dry-run` reads every image locally and reports a wrong size or an alpha channel by file name:

```bash
asc screenshots --dry-run
```

## 3. Configure

One device size:

```json
"screenshots": { "dir": "./assets/screenshots" }
```

Whatever a screenshot generator exported — any folder layout, any file names, devices mixed:

```json
"screenshots": { "from": "./exports" }
```

Every PNG under it is grouped by pixel size into device sets (iPhone 6.9", iPad 13", iPhone Duo…). A top-level folder named after a configured locale (`./exports/tr/…`) belongs to that locale. This is the handoff from a screenshot-generating skill: produce with it, point `from` at its output.

Several, explicitly (iPhone + iPad + Duo):

```json
"screenshots": {
  "api": "auto",
  "sets": [
    { "dir": "./shots/iphone" },
    { "dir": "./shots/ipad" },
    { "dir": "./shots/duo-outer" },
    { "dir": "./shots/duo-inner" }
  ]
}
```

- The device group of each set is inferred from the image size. Add `"placementGroup": "<id from --list-groups>"` when a size fits more than one group.
- Filename order is display order (`01-home.png`, `02-search.png`…).
- Localized screenshots: a locale subdirectory (`./shots/iphone/tr/`) overrides the set for that locale.
- `api`: `"auto"` (default) uses the App Asset Library and falls back to legacy screenshot sets if the library is unavailable; `"asset-library"` forces it; `"legacy"` forces the deprecated `appScreenshotSets` API (no Duo). With `legacy`, sets take a `displayType` (`APP_IPHONE_67`, `APP_IPAD_PRO_3GEN_129`, …) — there is no `APP_IPHONE_69`.

## 4. Deliver

```bash
asc screenshots --dry-run    # plan: uploads, placements, reorders, removals
asc screenshots              # apply
asc screenshots --no-prune   # keep remote screenshots that have no local file
```

What happens, per locale and device group:

1. Each file is identified by a short content hash in its uploaded name, so an unchanged image is never uploaded twice.
2. New images are reserved in the app's Asset Library, uploaded in parts, and committed.
3. A placement puts the image on the version localization; an ordering request sets the display order.
4. Remote screenshots without a local file are removed — placement first, then the asset — unless `--no-prune`.

Placements can only be created while the version is editable (`PREPARE_FOR_SUBMISSION`, or rejected). If the version is in review, open a new one first.

## App previews (videos)

```json
"previews": { "dir": "./previews", "posterFrame": "00:00:05:00" }
```

```bash
asc previews --dry-run
asc previews             # also a release step
```

- Up to three per device size, 15 to 30 seconds, `.mov` / `.mp4` / `.m4v`. Sizes come from Apple's catalog at run time — 886×1920 for the large iPhones and 1200×1600 for the 13" iPad today. Each file is grouped by its pixel size; size and length are checked locally before anything is uploaded.
- A locale subfolder (`./previews/tr/`) replaces the folder for that locale. Filename order is display order.
- Through the App Asset Library only. Apple processes a video after upload; it shows in App Store Connect a few minutes later.
- `asc previews --prune` removes placed previews that have no local file; screenshots are never touched by it, nor previews by `screenshots --prune`.

Custom product pages take their own screenshots and previews: see `references/custom-product-pages.md` in the **appstore-release** skill.

## When it fails

| Symptom                                             | Cause and fix                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `screenshots.dimensions.invalid.*`                  | Wrong size or alpha channel. Re-render at the exact size; flatten onto an opaque background.           |
| 409 `ENTITY_ERROR.ATTRIBUTE.INVALID` on a placement | The image's size does not belong to that placement group. Check `--list-groups`.                       |
| 409 `STATE_ERROR.INVALID_STATE` on a placement      | The version is not editable. `asc new-version`, or wait for the rejection.                             |
| 409 `STATE_ERROR.ASSET_HAS_PLACEMENTS`              | An asset was deleted before its placements. The tool orders this correctly; a manual cleanup must too. |
| Asset `FAILED` after upload                         | Processing rejected the file — read `stateDetails`; usually a corrupt or oversized file.               |
| `screenshots.upload.incomplete`                     | A previous run was interrupted. Re-run `asc screenshots`; it resumes.                                  |

More: [references/sizes.md](references/sizes.md), [references/producing.md](references/producing.md).

_Checked against the App Store Review Guidelines of June 8, 2026._
