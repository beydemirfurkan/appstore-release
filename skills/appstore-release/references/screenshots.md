# Screenshots — essentials

The full guide (every size, iPhone Duo, the App Asset Library, how to produce the images) is in the **app-store-screenshot-upload** skill. The short version:

- **Exact pixel sizes, no alpha channel, PNG or JPEG.** Filename order is display order.
- **iPhone:** one 6.9" set covers every iPhone — 1320×2868 (also 1290×2796 or 1260×2736). From April 2027, apps built with the iOS 27.1 SDK also need an **iPhone Duo** set: outer display 1398×2034, inner display 2007×2853.
- **iPad:** required when the app supports iPad — 13" at 2064×2752 (or 2048×2732).
- **Config:** `screenshots.dir` for one device size, or `screenshots.sets` (one `{ "dir": … }` per size) for several. The device group is read from the image size; give `placementGroup` explicitly only when a size is ambiguous.
- **API:** `screenshots.api` is `"auto"` by default — the App Asset Library (API 4.5.1), which is the only way to deliver iPhone Duo screenshots. `"legacy"` uses the deprecated screenshot sets.

```bash
asc screenshots --dry-run      # what would be uploaded, placed, reordered or removed
asc screenshots                # diff, then upload only what changed
asc screenshots --no-prune     # keep remote screenshots that have no local file
```
