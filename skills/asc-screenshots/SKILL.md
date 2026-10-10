---
name: asc-screenshots
description: Produce and upload App Store screenshots at the exact pixel sizes Apple requires — iPhone 6.9", iPhone Duo (foldable, required from April 2027), 13" iPad — through the App Store Connect App Asset Library, with diff-then-upload idempotency. Use when the user says "make App Store screenshots", "upload screenshots", "screenshot sizes", "iPhone Duo screenshots", "iPad screenshots are missing", "wrong screenshot dimensions", or when an App Store readiness check reports screenshots.* findings.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager). Producing images optionally uses the iOS Simulator (macOS) or headless Chrome/Chromium.
metadata:
  author: Furkan Beydemir
  version: "3.0.0"
---

# App Store screenshots

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

Several (iPhone + iPad + Duo):

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
