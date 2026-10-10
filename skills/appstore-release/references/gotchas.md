# Gotchas — every pitfall hit in practice

Read before the first run. Each one cost a round trip to discover. Headings are stable: findings link here by anchor.

## Credentials / build

- **Stale EAS distribution certificate.** `eas build` non-interactive fails: _"Provisioning Profile has expired … No certificate exists with serial …"_. EAS's stored certificate is out of sync with Apple (often because Xcode or a local prebuild created a new one). Fix: `asc credentials` issues or reuses a distribution certificate plus an `IOS_APP_STORE` profile and writes `credentials.json`; set `"credentialsSource": "local"` in the eas.json production profile. Details in the **ios-code-signing** skill.
- **`.p12` must be openssl `-legacy`.** OpenSSL 3's default PBE is not readable by EAS/node; use `openssl pkcs12 -export -legacy …`. The `credentials` command already does.
- **A local `ios/` directory wins.** If a native `ios/` directory exists, EAS uses it and _ignores_ app.json's `ios.bundleIdentifier` and `infoPlist`. Edit `ios/<app>/Info.plist` and `Images.xcassets/AppIcon.appiconset/`, not just app.json.
- **EAS's own ASC key** comes from `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, plus `EXPO_APPLE_TEAM_ID` and `EXPO_APPLE_TEAM_TYPE` (`IN_HOUSE` | `COMPANY_OR_ORGANIZATION` | `INDIVIDUAL`; only `IN_HOUSE` changes behaviour).
- **iOS 27 SDK.** From April 2027 every upload must be built with Xcode 27 / the iOS 27 SDK. Apps built with it must include a launch screen (`UILaunchScreen`, `UILaunchScreens`, `UILaunchStoryboardName` or `UILaunchStoryboards` in Info.plist) or App Review rejects them, and must use the scene-based lifecycle or they fail to launch.

## App icon

- **Ship a real 1024×1024 icon with no alpha channel.** The Expo starter `icon.png` is a placeholder with visible guide lines — Apple rejects it. Since Xcode 14 the App Store icon comes from the build's asset catalog, so **changing it requires a rebuild**. Replace both `assets/images/icon.png` and `ios/<app>/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`.
- Icons made with Icon Composer (`.icon`) get the Liquid Glass treatment; App Store Connect shows it, and the API reports it as `BuildIcon.masked`. A plain 1024 PNG is still accepted.

## Metadata

- **No emoji in `description`.** 409 `ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_CHARACTERS`. Use plain uppercase section headers; `•` and `—` are fine. The config validator flags this offline, in every locale.
- **`whatsNew` only for updates.** On a first version it 409s: `STATE_ERROR: Attribute 'whatsNew' cannot be edited`. Omit it until the second release.
- **Where fields live:** name, subtitle, **privacyPolicyUrl** → `appInfoLocalizations`. description, keywords, promotionalText, supportUrl, marketingUrl, whatsNew → `appStoreVersionLocalizations`. **copyright** → an `appStoreVersion` attribute.
- Limits: name 30, subtitle 30, keywords 100 (comma separated, no spaces needed), promotional text 170, description and whatsNew 4000. See [metadata.md](metadata.md).

## Age rating (2025 schema)

- The declaration lives on **appInfo** (`/v1/appInfos/{id}/ageRatingDeclaration`). The old `appStoreVersions/{id}/ageRatingDeclaration` path was removed in API 4.3.
- Apple wants the **full attribute set** in one PATCH, or it 409s. Two kinds of attribute:
  - content dimensions are enums — `NONE`, `INFREQUENT` or `FREQUENT` (the older `INFREQUENT_OR_MILD` / `FREQUENT_OR_INTENSE` are deprecated; the config still accepts them and maps them);
  - behavioural flags are booleans — `advertising`, `ageAssurance`, `gambling`, `healthOrWellnessTopics`, `lootBox`, `messagingAndChat`, `parentalControls`, `socialMedia`, `socialMediaAgeRestricted`, `unrestrictedWebAccess`, `userGeneratedContent`.
- `socialMedia` and `socialMediaAgeRestricted` are required for new apps and updates since September 2026; `ageAssurance` has been required since 2025. `false` is a valid answer — missing is not.
- **Never send `ageRatingOverride` together with `ageRatingOverrideV2`** → 409. The old one is deprecated; this tool only sends V2, and only when `ageRating.override` is set.
- `kidsAgeBand` is deprecated and no longer sent.
- Details and the question each attribute answers: the **app-store-age-rating** skill.

## Pricing / availability

- A new app needs a **price schedule** (even Free) **and** a **copyright**, or _Add for Review_ fails with _"You must choose a price tier"_ / _"copyright … required"_. `asc pricing` sets both.
- `price: "free"` or `price: { "amount": 2.99, "baseTerritory": "USA" }`. Apple only accepts its own price points; the nearest one to `amount` is chosen and reported.
- Setting a price schedule fills availability across all territories. An explicit `appAvailabilityV2` may 404 or be unset; it does not block once a schedule exists.

## Screenshots

- **Exact sizes only**, no alpha channel, PNG or JPEG. Full table: the **app-store-screenshot-upload** skill.
- **The set-based API is deprecated** (ASC API 4.5.1, October 2026) in favour of the **App Asset Library**: upload each image once, then create _placements_ per localization and device group. iPhone Duo screenshots exist **only** in the Asset Library. This tool uses the Asset Library by default (`screenshots.api: "auto"`).
- Legacy (`screenshots.api: "legacy"`): the largest iPhone type is **`APP_IPHONE_67`** — there is no `APP_IPHONE_69` (409 lists the valid types). Upload is reserve (`POST /v1/appScreenshots`) → PUT each `uploadOperations` part → PATCH `{uploaded: true, sourceFileChecksum: md5}`. A screenshot that skips the commit stays invisible, with nothing in the UI to explain why.
- Asset Library: commit takes `{uploaded: true}` alone. An asset with placements cannot be deleted (`STATE_ERROR.ASSET_HAS_PLACEMENTS`) — delete the placements first. A placement cannot be edited; replace it and reorder.

## App Privacy (UI-ONLY)

- Every `appDataUsages*` API path 404s — Apple keeps the data-collection nutrition label UI-only. It must be completed and **Published** in App Store Connect before the version can be reviewed. It is the one thing this tool cannot do. Once the user confirms it is published, set `review.privacyPublished: true`; the API cannot verify it, so never set it on your own.
- **NSUserTracking conflict:** if the binary contains `NSUserTrackingUsageDescription` but every data type is declared "not used for tracking", **Publish is disabled** (_"you must indicate which data types are tracking users"_). If the app truly does not track, **remove the key** from app.json _and_ the native Info.plist, rebuild, upload — then Publish works.

## Subscriptions / IAPs

- **An app's first subscription or in-app purchase goes with the version.** Apple's 4.4.1 notes: _"Submit your first subscription together with an app binary submission through appstoreconnect.apple.com. For subsequent subscriptions, submit using the API endpoints."_ Teams submit the first one by API in the same review submission, so `asc submit` tries that (`check` reports `subscription.first.with-version`, INFO). If App Store Connect refuses, nothing is submitted: the product items are deleted from the draft (`DELETE /v1/reviewSubmissionItems/{id}`), and the result is `manual` with the clicks — or `asc submit --submit --skip-products` sends the app alone. Once one subscription has been approved, later ones are versioned (`subscriptionVersion` items, API 4.4.1) and `asc submit` adds them to the same review submission as the version. The old 409 _`'subscription' is not a relationship`_ came from the pre-4.4.1 model.
- A subscription leaves `MISSING_METADATA` only with: a group localization (display name), a subscription localization (name + description), a **price**, and a **review screenshot** of the paywall. Details: the **app-store-subscriptions** skill.

## Review submission

- Model: `reviewSubmissions` (POST) + `reviewSubmissionItems` (the version, and any subscription versions) → PATCH `{submitted: true}`. One open submission per app and platform; reuse it.
- An empty or dangling submission may resist DELETE (403). Cancel a submitted one with PATCH `{canceled: true}` (state → CANCELING, then the version becomes `DEVELOPER_REJECTED`, editable again).
- **App Review contact info** (name, phone, email) is required — `asc review-info`.
- Export compliance: `ITSAppUsesNonExemptEncryption = false` in Info.plist avoids the encryption question on every build.
- The rejection _text_ lives in App Store Connect (App Review → Messages); there is no API for it. See **app-store-rejection**.

## Handy

- `git check-ignore <file>` before committing confirms secrets (`.p8`, `credentials.json`, `*.p12`, `*.mobileprovision`) are ignored.
- The Playwright MCP browser blocks `file:` URLs — serve HTML with `python3 -m http.server` and use `http://localhost:…`, or render with headless Chrome directly.
