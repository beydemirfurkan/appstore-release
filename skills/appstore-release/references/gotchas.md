# Gotchas — every pitfall hit in practice

Read before the first run. Each cost a round-trip to discover.

## Credentials / build

- **Stale EAS distribution certificate.** `eas build` non-interactive fails: _"Provisioning Profile has expired … No certificate exists with serial …"_. EAS's stored cert is out of sync with Apple (often because Xcode/local prebuild created a new one). Fix: `appstore-release credentials` generates a fresh distribution cert + `IOS_APP_STORE` provisioning profile via the API, writes `credentials.json`; set `"credentialsSource":"local"` in the eas.json production profile. Fully non-interactive.
- **`.p12` must be openssl `-legacy`.** Modern OpenSSL 3 default PBE isn't readable by EAS/node; use `openssl pkcs12 -export -legacy …`.
- **Local `ios/` dir wins.** If a native `ios/` directory exists, EAS uses it and _ignores app.json's_ `ios.bundleIdentifier` and `infoPlist`. Native `ios/<app>/Info.plist` + `Images.xcassets/AppIcon.appiconset/` are the real source for the build — edit those, not just app.json.
- **ASC API key for build** = env `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, plus `EXPO_APPLE_TEAM_ID`, `EXPO_APPLE_TEAM_TYPE` (values: `IN_HOUSE`|`COMPANY_OR_ORGANIZATION`|`INDIVIDUAL`; only `IN_HOUSE`/Enterprise changes behaviour — INDIVIDUAL and COMPANY are equivalent for App Store).

## App icon

- **Ship a real 1024×1024 icon with NO alpha channel.** The Expo starter `icon.png` is a placeholder (light-blue caret WITH visible design guide lines) — Apple rejects placeholders. Since Xcode 14 the App Store icon comes from the build's asset catalog, so **changing it requires a rebuild**. Replace both `assets/images/icon.png` AND `ios/<app>/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`.
- Render icons/screenshots headless: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 --screenshot=out.png <url>` → produces **no-alpha** PNG at exact size (verify `sips -g hasAlpha`).

## Metadata

- **No emoji in `description`.** ASC 409 `ATTRIBUTE.INVALID.INVALID_CHARACTERS`. Use plain uppercase section headers. (`•` and `—` are fine.)
- **`whatsNew` only for updates.** First version 409s `STATE_ERROR: Attribute 'whatsNew' cannot be edited`. Omit it on the first release.
- **Where fields live:** name/subtitle/**privacyPolicyUrl** → `appInfoLocalizations`. description/keywords/promotionalText/supportUrl/marketingUrl/whatsNew → `appStoreVersionLocalizations`. **copyright** → `appStoreVersion` attribute.

## Age rating (2025 schema)

- Declaration lives on **appInfo** (`/v1/appInfos/{id}/ageRatingDeclaration`), NOT on the version (version relationship 404s).
- Requires the FULL attribute set. Content dimensions are enums → `"NONE"` (incl. `gunsOrOtherWeapons`, `healthOrWellnessTopics`? — no: those two are: `gunsOrOtherWeapons` is an ENUM "NONE"; the booleans are the behavioural flags). Behavioural flags are booleans → `false`: `gambling, unrestrictedWebAccess, lootBox, advertising, userGeneratedContent, parentalControls, messagingAndChat, healthOrWellnessTopics, ageAssurance`. `kidsAgeBand:null`.
- **Do not send `ageRatingOverride` together with `ageRatingOverrideV2`** → 409. Send neither (leave as-is) or only V2.
- `ageAssurance` is **required** (missing → 409). `false` works.

## Pricing / availability

- A new app needs a **price tier** (even Free) AND **copyright**, else `Add for Review` errors: _"You must choose a price tier"_ / _"copyright … required"_. `appstore-release pricing` sets Free (USA base price point 0) + copyright.
- Setting the Free price schedule auto-fills availability across territories (≈175). Explicit `appAvailabilityV2` may 404 / be unset but doesn't block once a price schedule exists.

## Screenshots

- Exact sizes only. Largest iPhone type in the API is **`APP_IPHONE_67`** (1290×2796) — **there is no `APP_IPHONE_69`** (409 lists valid types). 1290×2796 satisfies the 6.9″/6.7″ requirement. iPad not required when `supportsTablet:false`.
- Upload = reserve (`POST /v1/appScreenshots`) → PUT each `uploadOperations` chunk → PATCH `{uploaded:true, sourceFileChecksum:md5}`. Then order via `PATCH /v1/appScreenshotSets/{id}/relationships/appScreenshots`.

## App Privacy (UI-ONLY)

- All `appDataUsages*` API paths **404** — Apple keeps the data-collection nutrition label UI-only. Must be completed + **Published** in ASC before the version can be reviewed.
- **NSUserTracking conflict:** if the binary contains `NSUserTrackingUsageDescription` but you answer "not used for tracking" for all data types, **Publish is disabled** ("you must indicate which data types are tracking users"). If the app truly doesn't track, **remove the key** from `app.json` _and_ the native `Info.plist`, **rebuild**, re-upload — then Publish works.

## Subscriptions / IAPs

- **First subscription must be attached to the version in the UI before submitting.** `reviewSubmissionItems` has no `subscription` relationship (409 `'subscription' is not a relationship`). A pure-API `appstore-release submit` submits the app version ALONE, leaving the sub `READY_TO_SUBMIT`. To include it: cancel the submission if already sent, then in the UI version page → _In-App Purchases and Subscriptions → Select → <product>_ → Save → _Add for Review → Submit_. After that, additional subscriptions can be submitted independently.
- Subscription needs: group localization (display name), sub localization (name+description), a **price** (find pricePoint via `/v1/subscriptions/{id}/pricePoints?filter[territory]=`), and a **review screenshot** (`subscriptionAppStoreReviewScreenshots`) to leave `MISSING_METADATA` → `READY_TO_SUBMIT`.

## Review submission

- Model: `reviewSubmissions` (POST, platform IOS) + `reviewSubmissionItems` (the appStoreVersion) → PATCH `{submitted:true}`. Only ONE open submission per app+platform; reuse it.
- An empty/dangling submission may resist DELETE (403). Cancel a submitted one with PATCH `{canceled:true}` (state → CANCELING → then version becomes `DEVELOPER_REJECTED` = editable again).
- **App Review contact info (name/phone/email) is required** — settable via `appStoreReviewDetail` (`appstore-release review-info`), or the user fills it in the UI.
- Export compliance: `ITSAppUsesNonExemptEncryption=false` in Info.plist avoids the encryption question.

## Handy

- `git check-ignore <file>` before committing to confirm secrets (`.p8`, `credentials.json`, `*.p12`, `*.mobileprovision`) are ignored.
- `file:` protocol is blocked in the Playwright MCP browser → serve HTML over `python3 -m http.server` and use `http://localhost:…`, or render with headless Chrome directly.
