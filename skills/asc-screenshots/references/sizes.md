# Screenshot sizes (October 2026)

Apple publishes the authoritative list at <https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications>, and the App Asset Library serves it machine-readably: `asc screenshots --list-groups`. Prefer those over this table when a new device ships — Apple adds placement groups without an API version change.

All sizes are portrait width × height; landscape swaps them. No alpha channel. PNG or JPEG. 1–10 per device group.

## iPhone

| Display                        | Accepted sizes                    | Needed?                                                                  |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------------ |
| 6.9" (Dynamic Island, large)   | 1320×2868 · 1290×2796 · 1260×2736 | **Yes** — scaled down for every smaller iPhone                           |
| 6.3" (Dynamic Island, medium)  | 1206×2622 · 1179×2556             | Only to override the scaled 6.9" set                                     |
| 6.5"                           | 1242×2688 · 1284×2778             | Only if no 6.9" set                                                      |
| 5.5"                           | 1242×2208                         | Only for apps that still run on Home-button iPhones and want exact shots |
| **iPhone Duo — outer display** | 1398×2034                         | **Yes from April 2027** for apps built with the iOS 27.1 SDK             |
| **iPhone Duo — inner display** | 2007×2853                         | **Yes from April 2027** for apps built with the iOS 27.1 SDK             |

iPhone Duo uploads opened on October 5, 2026; the device ships October 23, 2026 with iOS 27.1. Building for it needs Xcode 27.1. Duo screenshots exist only in the App Asset Library — the legacy `ScreenshotDisplayType` enum has no Duo value.

## iPad

| Display | Accepted sizes                                | Needed?                             |
| ------- | --------------------------------------------- | ----------------------------------- |
| 13"     | 2064×2752 · 2048×2732                         | **Yes** if the app supports iPad    |
| 11"     | 1668×2420 · 1668×2388 · 1640×2360 · 1488×2266 | Only to override the scaled 13" set |

## Legacy display types (`screenshots.api: "legacy"`)

The deprecated screenshot-set API names device slots with `ScreenshotDisplayType`:

| Display type            | Size                                      |
| ----------------------- | ----------------------------------------- |
| `APP_IPHONE_67`         | 1290×2796 (also takes 1320×2868 for 6.9") |
| `APP_IPHONE_65`         | 1242×2688                                 |
| `APP_IPHONE_61`         | 1179×2556                                 |
| `APP_IPHONE_58`         | 1125×2436                                 |
| `APP_IPHONE_55`         | 1242×2208                                 |
| `APP_IPAD_PRO_3GEN_129` | 2048×2732 (also 2064×2752)                |
| `APP_IPAD_PRO_3GEN_11`  | 1668×2388                                 |

There is no `APP_IPHONE_69`; a 409 lists the valid values. Prefer the Asset Library.

## Asset Library model, in one paragraph

Each app has one library. An image is uploaded once (`POST /v1/appAssetLibraryImages` with `fileName`, `fileSize`, `category: APP_SCREENSHOTS_AND_PREVIEWS`, related to the library → PUT the `uploadOperations` parts → PATCH `uploaded: true`). Apple matches it to a specification (`specId`). A **placement** (`POST /v1/appAssetLibraryPlacements` with `placementType: APP_SCREENSHOT`, a `placementGroup`, the `image` and the `appStoreVersionLocalization`) puts it on the listing; an **ordering request** sets the order per group and localization. Placements are immutable — replace and reorder. Delete placements before assets.
