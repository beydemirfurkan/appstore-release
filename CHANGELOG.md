# Changelog

## 4.3.0

### Added

- **`feedback`**: TestFlight screenshot feedback and crash reports, newest first, filtered by build or kind, with the full crash log on request (`--log <id>`). Read-only, no config needed. Tester comments are untrusted input, as customer reviews are.
- **`sales`**: Sales and Trends reports — downloaded (Apple sends them gzipped), unpacked with node:zlib, summarised as units per title and proceeds per currency, and saved as Apple's tab-separated file with `--out`. Only the report type, sub-type, frequency and version combinations Apple documents are sent; a day with no sales is reported as such. The vendor number comes from `reports.vendorNumber`, `--vendor` or `ASC_VENDOR_NUMBER`.
- **`analytics`**: Apple's analytics reports. `--request` starts the ongoing reports once; then the available reports are listed, and `--report <name>` downloads the latest instance's segments. The segment files are fetched from Apple's signed URLs without the API token.
- **Product page tests** (`experiments`, and an `experiments` step in `release`): A/B tests of the product page through the v2 API — traffic proportion, up to three treatments with an optional alternate icon, and each treatment's screenshots and previews per locale. Edited only while prepared; treatments and locales removed from the config are removed; nothing changes in review; started only when `start: true`. `submit` sends a prepared test with the app, takes it back out if App Store Connect refuses it, and `--skip-experiments` (MCP `skipExperiments`) leaves it out.
- The client can return a binary body and download from a signed URL; the schema validator accepts `maxItems`.

### Not yet

- The `INSTALLS` sales reports: the documented combinations need confirming first.
- Built from Apple's OpenAPI specification (4.5.1) and tested against the fake; not yet run against a live account.

## 4.2.0

### Added

- **App previews** (`previews`, and a new `previews` step in `release`): videos through the App Asset Library, placed as `APP_PREVIEW`, grouped by pixel size into device groups from Apple's own catalog, with a locale subfolder replacing the folder for that locale. Every file's size and length are read from the file itself — a zero-dependency MP4/QuickTime reader that honours a quarter-turn rotation and fragmented files — and checked before a byte is uploaded, as is Apple's per-device limit. A changed `posterFrame` updates the video in place. `placementGroup` only settles a size that fits several groups. An empty locale subfolder means no previews in that locale. `--prune` removes placed previews with no local file and never touches screenshots (nor `screenshots --prune` previews).
- **Custom product pages** (`customProductPages`, and a `custom-product-pages` step): a page per campaign with its own promotional text, deep link, screenshots and previews, per locale. An approved page version cannot change, so a new version is created only when the config differs from it — text, deep link, a locale added or removed, any screenshot or preview, a device group emptied — and nothing is written otherwise; while a version is in review, nothing is attempted. A removed locale or emptied device group is removed from an editable version. `visible` is applied once a version is approved. `submit` sends an editable page version (one with at least one locale) in the same review submission as the app; if App Store Connect refuses a page, its items are taken back out and nothing is submitted, and `submit --submit --skip-pages` (MCP `skipPages`) sends the rest.

### Changed

- The App Asset Library reconciliation behind screenshots now also serves previews (videos) and custom product page localizations, with a check-only mode. Screenshots behave exactly as before; placements are now always filtered by placement type, so previews and screenshots in the same device group never mistake each other for orphans.

### Not yet

- Previews and custom product pages are built from Apple's OpenAPI specification (4.5.1) and tested against the fake; not yet run against a live account. The preview frame time code is passed through as written: its format is not documented in the specification.

## 4.1.0

### Added

- **Promotional offers and offer codes** on a subscription, from the config (`promotionalOffers`, `offerCodes` with `customCodes`). Created when missing as part of `subscription` and `release`, with prices inline in the territories you name. Apple does not let an offer's terms change once created, so a difference is reported (`subscription.promotional-offer.changed.*`, `subscription.offer-code.changed.*`) instead of being written. The one thing it allows is kept in step: a promotional offer's prices. `"active": false` deactivates an offer code or a custom code (and no new custom codes go to one that is off); nothing is deleted.
- **`appstore-release offer-codes`** generates batches of one-time codes (`oneTimeCodes`) and writes each to a CSV file (mode 600), once; two batches with the same count and expiry are two batches. Never part of `release`: a batch spends Apple's code quota. `--dry-run` writes no file. If Apple is still generating a batch, it says so; a download it refuses outright (a key's role) is an error, not an endless wait. It warns when the file is not ignored by git.
- **Accessibility Nutrition Labels** (`accessibility`, and a new `accessibility` step in `release`): one declaration per device, features the config leaves out declared as not supported, drafts until `"publish": true`, plus the app's accessibility URL.
- **A refused first product is remembered.** App Store Connect keeps no record of a refused attempt; `submit` now keeps one in a small per-app file outside the project (`APPSTORE_RELEASE_STATE_DIR`, else `~/.cache/appstore-release/state`). `check` then shows the product as UI-only with the clicks (`*.first.refused`) for that version, instead of "ready", and `submit --submit --skip-products` still sends the app alone. A product that `release` changes afterwards is tried by API again. The CLI and the MCP tool now share one submit gate, and `--skip-products` never submits a version that is in review, approved or live.
- The config schema accepts `format: date`, `minItems` and `uniqueItems`; an impossible date such as `2027-02-30` is refused offline.

### Not yet

- Win-back offers: Apple's API 4.5.1 does not document how to price one.
- Offers and offer codes are built from Apple's OpenAPI specification (4.5.1) and tested against the fake; not yet run against a live account.

## 4.0.2

### Fixed

- **Paths in a monorepo.** A config in `mobile/` could not point at `../app-store-screenshots/`: every path had to stay inside the config's own folder. Paths may now reach anywhere in the git repository the project is in — never the home directory or the root of the disk, even when one of them is a repository. Relative paths still resolve against the config's folder.
- **Windows.** CI now runs on Windows (Node 20, 22 and 24). Files are checked out with LF everywhere (`.gitattributes`), tests run through `scripts/test.mjs` instead of a shell glob that Windows and Node 20 do not expand, and `preflight --expo-config` calls `npx.cmd` through a shell on Windows.

## 4.0.1

Fixes from running 4.0.0 against a live app.

### Fixed

- **`subscription.terms-link.missing` missed real terms links.** `Kullanım Şartları: https://…/terms` and a bare `Terms: https://…/terms` were reported as no link. A URL whose path is `/terms`, `/eula` or `/tos` now counts, and so does a word for terms on the same line as a URL.
- Preflight named `app.config.js` when the unread dynamic config was `app.config.ts`; it now names the file.
- `better-auth` counts as an account library for the account-deletion and review-notes checks.

## 4.0.0

The app itself, not only its listing: an offline preflight for what App Review rejects in the code and the Info.plist, App Store rules corrected against Apple's own wording, and skill names people search for.

### Breaking

- **Skills renamed** to what people search for. The router keeps its name.

  | 3.x                 | 4.0                           |
  | ------------------- | ----------------------------- |
  | `asc-screenshots`   | `app-store-screenshot-upload` |
  | `asc-age-rating`    | `app-store-age-rating`        |
  | `asc-subscriptions` | `app-store-subscriptions`     |
  | `asc-rejection`     | `app-store-rejection`         |
  | `asc-credentials`   | `ios-code-signing`            |
  | `asc-testflight`    | `app-store-testflight`        |
  | `asc-reviews`       | `app-store-customer-reviews`  |

  Upgrading: `npx skills remove asc-screenshots asc-age-rating asc-subscriptions asc-rejection asc-credentials asc-testflight asc-reviews`, then `npx skills add beydemirfurkan/appstore-release`. MCP resource URIs under the old names (`appstore-release://skills/asc-*`) still resolve.

- **`check` has a new first section, App**, from the preflight below. A problem read off the app — an invalid required-reason code or category in a privacy manifest — now blocks, so a version that was `ready` can come back `blocked`. Anything inferred from a dependency or the source, a missing usage description included, is a warning.
- **Keywords are limited to 100 bytes**, as Apple words it, not 100 characters. A Turkish or Japanese keyword list that passed before can now be refused offline (`config.*.keywords.too-long`).
- **What's New is required on every version after the first**, in every locale (`metadata.whatsNew.missing`, blocker). "First" is now decided in one place: no other version of the app on the platform — not "1.0", not the version count.
- **An app's first subscription or in-app purchase is submitted with the version, by API.** 3.1.0 left it to the website after Apple's 4.4.1 note (_"Submit your first subscription together with an app binary submission through appstoreconnect.apple.com"_); teams submit it by API in the same review submission, so `submit` now tries that. If App Store Connect refuses — when the item is added or at the final submit — nothing is submitted, the product items are removed from the draft (`DELETE /v1/reviewSubmissionItems/{id}`), and the result is `manual` (exit 5) with the clicks. `submit --submit --skip-products` sends the app alone. `subscription.first.ui-only` / `iap.first.ui-only` (blocker) became `*.first.with-version` (info). Not yet confirmed on a live account either way.

### Added

- **`appstore-release preflight`**: reads the project — Expo `app.json` with plugin precedence, `Info.plist`, `INFOPLIST_KEY_*` build settings, `PrivacyInfo.xcprivacy`, and the source — offline, with no credentials. It reports missing and generic permission texts (5.1.1(ii)), invalid required-reason codes, SDKs from Apple's privacy-manifest list, third-party login without an equivalent private option (4.8), account creation without deletion (5.1.1(v)), external payments (3.1.1), no restore purchases (3.1.2), tracking without ATT (5.1.2(i)), insecure HTTP, secrets in the bundle and undeclared export compliance. Each finding has the guideline and the file and line. A blocker only when certain; anything inferred is a warning, waivable with a reason in `preflight.ignore`. It ends with what only a test on a device can prove. `--expo-config` evaluates a dynamic `app.config.js/ts`; `--json` for scripts. MCP: `asc_validate_config` with `preflight: true` (still 13 tools).
- **The app-store-preflight skill**, with checklists by kind of app: subscriptions, sign-in, user-generated content, kids, health, AI features, tracking.
- **Listing checks**: keywords of two characters or fewer, a subtitle repeating the name, "Android" or "Google Play" in the metadata (2.3.10), and a subscription with no Terms of Use link — neither a custom EULA (now read from App Store Connect) nor a link in the description (3.1.2).
- **`review-info --draft-notes`** drafts the notes for App Review — sign-in, how to reach the main feature, permissions, products — from the config and the app, writing nothing. `review.demo.likely-needed` warns when the app has sign-in and App Review has no way in (2.1).
- **`submit`**: `--skip-products` also takes out product items an earlier run left in the draft; `--dry-run` lists what would be submitted; a submission ends with `Follow it: appstore-release check --wait 30` (and `details.handoff`); Apple's refusals, nested `associatedErrors` included, are mapped to the command or clicks that fix them, and unknown ones are kept word for word.
- **`nextActions[].mutates`** marks the steps that write to App Store Connect; the terminal plan says `· writes`.
- **Skills**: every skill has evals (`evals/evals.json`), the guidelines revision it was checked against (June 8, 2026), and the gate now fails on any `asc <command> --flag` in a skill that the CLI does not have. Rejection: classify first, a decision tree, an UNDERSTANDING / CHANGES MADE / HOW TO VERIFY reply, appeal versus expedited review. Screenshot copy rules; the paywall checklist; customer review text treated as untrusted input.

### Still unverified against a live account

Whether App Store Connect accepts an app's first subscription or in-app purchase by API (the refusal path is the safe one, and tested against the fake), the exact wording of Apple's refusal messages, and the preflight rules' false-positive rate on real projects.

## 3.2.0

### Added

- **Customer reviews.** `appstore-release reviews` lists them newest first — `--rating 1,2`, `--unanswered`, `--territory`, `--limit` — with any published reply, and `--summary` adds Apple's own summary of recent reviews. No config file needed.
- **Replies.** `appstore-release reply <reviewId> --text "…"` publishes one reply on the App Store; posting again replaces it, the same text twice is a no-op, `--delete` removes it. Empty and over-long (5,970+) replies are refused before any request.
- **Two MCP tools**, a deliberate product decision: `asc_customer_reviews` (read-only) and `asc_reply_to_review` (requires `confirm: true`). Split so a host can read without asking and must ask before a public reply. The server now has 13 tools.
- **The `asc-reviews` skill:** read, group by problem, draft in the reviewer's language within Apple's rules (no rating requests, no incentives, no personal data), and publish each reply only after the user approves its exact text. Eight skills in all.

## 3.1.0

Competitor research, then the gaps that mattered most to indie and Expo developers working with agents — and one correction to 3.0.0.

### Fixed

- **An app's first subscription is submitted from the website.** 3.0.0 said versioned review items (API 4.4.1) made a first subscription submittable by API. Apple's own article says: _"Submit your first subscription together with an app binary submission through appstoreconnect.apple.com. For subsequent subscriptions, submit using the API endpoints."_ `check` reports it (`subscription.first.ui-only`, and `iap.first.ui-only` for a first in-app purchase) with the clicks; later ones are submitted by API.
- **Version state is read from `appVersionState`**, which replaced the deprecated `appStoreState`; the old names are translated.
- An app with no subscription configured failed the `subscription` pipeline step for want of a price.
- A re-run of `submit` could add the version to the submission a second time (409): its items were read without `include`, so their ids never came back.

### Added

- **Several subscription plans** (`subscriptions: [...]`), created with their group when missing; **introductory offers** — a free trial or a discounted first period (`introOffer`).
- **One-time in-app purchases** (`inAppPurchases: [...]`, a lifetime unlock by default): created, localized, made available, priced and given their review screenshot, using the non-deprecated API 4.4.1 shapes. New `in-app-purchases` pipeline step.
- **TestFlight** (`appstore-release testflight`): export compliance, What to Test, internal and external groups, testers by email, the beta description and review contact, and beta app review. New `asc-testflight` skill.
- **Follow a review:** `check --wait <minutes>` (exit `0` approved, `5` rejected, `8` still waiting), a new `approved` verdict, and `waitMinutes` on the MCP readiness tool.
- **The rejection loop:** `submit --submit --resolved` resubmits a rejected version, marking its items resolved.
- **Expo projects as they are:** `store.config.json` (EAS Metadata) is translated and used — on its own or under `easMetadata` — with the app id from eas.json and the bundle id from app.json.
- **`screenshots.from`:** point it at any screenshot generator's output; PNGs are grouped into device sets by pixel size.
- **Listing lints:** placeholder text (Guideline 2.1) and wasted keyword characters.
- **A terminal report you can read at a glance:** colour, one line per section, and a plan that collapses to a single `release` when that fixes everything. Run the CLI and the MCP server with `npx github:beydemirfurkan/appstore-release`, without cloning or an npm package.

### Still unverified against a live account

App Asset Library uploads, versioned subscription and in-app purchase submission, introductory offers without a territory, and TestFlight are built from Apple's documentation and tested against a fake App Store Connect that follows it. Run `--dry-run` first on a real app.

## 3.0.0

Updated for iOS 27 and App Store Connect API 4.4.1–4.5.1, split into agent skills, and — most importantly — able to finish a submission end to end, which 2.1.0 could not.

### Breaking

- **App Privacy now needs your word for it.** The readiness report used to block on App Privacy unconditionally, which meant the verdict could never be `ready` and `submit --submit` always refused. Once the privacy label is published in App Store Connect, set `"review": { "privacyPublished": true }`. Without it, `check` still blocks with the exact clicks.
- **A first subscription is submitted by API.** `submit` adds the subscription version — and its group's, for a new group — to the same review submission as the app version (API 4.4.1). The `subscription.first.ui-only` finding is gone; `subscription.ready-to-submit` (info) replaces it.
- **Age-rating frequencies are `NONE` / `INFREQUENT` / `FREQUENT`.** The pre-2025 `INFREQUENT_OR_MILD` / `FREQUENT_OR_INTENSE` are still accepted in a config and mapped.
- **`credentials` asks before issuing any certificate**, not only the last of Apple's three. Pass `--allow-new-cert`.
- **Screenshots go through the App Asset Library by default** (`screenshots.api: "auto"`). Apps without a library fall back to the deprecated screenshot sets automatically; `"legacy"` forces them.

### Fixed — the product could not complete a submission

- Operation flags were rejected before the operation was known: `submit --submit`, `--allow-new-cert`, `--build`, `--no-prune` all exited 2. Flags are kebab-case as documented, positional arguments reach the operation (`new-version 1.2.0`), and `<command> --help` lists a command's own flags.
- `asc_submit_for_review` dropped `force` and reported `submitted: true` whatever happened. `asc_apply_release` pruned screenshots by default, and its `only` argument could run `credentials` or `submit` past their own gates; it now accepts pipeline steps only.
- `submit` no longer reuses a submission that is already with Apple, treats one in flight as a no-op instead of "not ready", and no longer swallows 409s when adding items.
- One list of version states. A version removed from sale no longer counts as editable, discovery never falls back to a live version, and the editable App Info is preferred during an update.
- `review-info`, `category`, `release-options`, `pricing` and no-prune `screenshots` no longer write on every run. `attach-build` only considers VALID, unexpired iOS builds of the version's marketing version. Subscription pricing reads every page of price points and touches only its own territory. `screenshots.sets` no longer requires a top-level `dir`.

### Added — iOS 27 / API 4.5.1

- **App Asset Library** screenshots: placement groups and exact specs from `appAssetLibraryRefData` (never hard-coded), a content hash in `referenceName` for idempotency, one upload reused across locales, ordering requests, placement-first deletes.
- **iPhone Duo**: a set with `placementGroup`; `screenshots --list-groups`; a reminder before Apple's April 2027 requirement.
- Every accepted 6.9" and 13" size and landscape; screenshots with alpha are refused before upload.
- Age rating: `socialMedia`, `socialMediaAgeRestricted`, and `ageRating.override` → `ageRatingOverrideV2`.
- `subscription.localizations` for other locales; existing localizations are updated, not only created.

### Added — agent skills

- A router skill (`appstore-release`) and five focused skills: `asc-screenshots`, `asc-age-rating`, `asc-subscriptions`, `asc-rejection`, `asc-credentials`. Installable with `npx skills add beydemirfurkan/appstore-release`, each with a launcher that finds the CLI even when only the skill folder was copied.
- `AGENTS.md`, `skills.sh.json`, every skill served as an MCP resource.
- `check-skills` and launcher-drift gates; CI runs them and the distribution gate on every PR.

### Added — try it, see it

- A stateful fake App Store Connect and an end-to-end test that drives the real CLI from blocked to `WAITING_FOR_REVIEW`, asserting a second `release` sends nothing.
- `source scripts/demo/setup.sh` runs the whole flow locally with no Apple account. The README's GIFs are recorded from it (`npm run media`).
- A shorter terminal report: each section names what is wrong, the plan names the command, nothing is printed twice.

### Changed — distribution

**Nothing to install.** The package is no longer published to any registry, and it no longer has runtime dependencies. `git clone && node src/cli.mjs` and `git clone && node src/mcp/server.mjs` are the whole setup.

That meant replacing `@modelcontextprotocol/sdk` and `zod` with about 250 lines: a newline-delimited JSON-RPC 2.0 transport and the six MCP methods this server actually implements. The replacement was checked against a captured wire trace of the SDK server rather than against the spec from memory; the only differences left are deliberate — `listChanged: false` because we never send those notifications, `additionalProperties: false` on tool inputs, and clearer validation messages.

Tool input schemas are now plain JSON Schema, which is what went on the wire anyway. The same validator that checks a user's config now checks a model's tool arguments.

This also fixes the Claude Code plugin properly. A plugin install is a git clone with no install step, so a server that needed `node_modules` could never have run there; `.mcp.json` now points straight at the file instead of shelling out to a package manager.

A `check:dist` gate fails the build if a runtime dependency reappears or anything under `src/` imports something that would need installing, and a CI job drives both the CLI and the MCP server from a bare checkout.

## 2.1.0

Everything here is additive: a 2.0.0 config still means exactly what it did.

### Added

- **`asc_open_next_version`, the eleventh MCP tool.** Deliberate, not drift: without it an agent that hit `version.none` had no way forward at all, since every other tool needs an editable version to act on.
- **The rejection report says what the API actually knows.** It now reads the open submission's items and distinguishes a metadata rejection from a binary one, while stating plainly that the reviewer's message lives in Resolution Center and is not exposed through the API. Also reports `UNRESOLVED_ISSUES`, which is a submission Apple would not accept at all rather than one it reviewed and rejected.
- **`new-version`.** There was no `POST /v1/appStoreVersions` anywhere, so once every version was live the tool had no way forward: the snapshot correctly refuses to target a live version, and then nothing could open the next one. It infers the next number from the newest existing version, or takes one explicitly, and is a no-op when a version is already editable. The readiness report now points at it.
- **Release timing (`release-options`).** `review.releaseType` sat in the config template from the first release and was read by nothing — a documented setting that silently did nothing. It works now, from a top-level `release` block (`type`, `earliestDate`, `phased`), because release timing is not review information. `review.releaseType` still works and warns. Phased release is supported; SCHEDULED without a date is refused rather than sent.
- **Arbitrary age ratings.** The declaration was a hardcoded 21-key 4+ constant, so an app with any mature content could not use this tool at all. `config.ageRating` now names only what differs; the complete attribute set is still always sent, because Apple returns 409 for a partial one. `ageRating4Plus: false` keeps its old meaning. It also reads before writing, so an unchanged declaration reports OK instead of a change.
- **Paid price tiers.** `pricing` only understood `price: "free"`, so a paid app could not be released. `price` now also takes `{ amount, baseTerritory }`, resolved to Apple's nearest price point — the same logic subscriptions already used, now shared rather than duplicated. It says so when the nearest point differs from the amount asked for, rather than silently charging something else.
- **Multiple screenshot device sizes.** `screenshots.displayType` handled exactly one, so an app supporting iPad could not be submitted at all — Apple requires an iPad set for a tablet-capable build and there was no way to express one. `screenshots.sets` takes an entry per device size, and a subdirectory named after a locale (`./shots/tr/`) overrides the base directory for that locale, so a multi-locale multi-device config does not become a matrix written out by hand. Each set is diffed and reported independently.
- **Multi-locale listings.** `config.locale` was a single string, so an app listed in more than one language got exactly one localization filled and the rest left empty — which Apple rejects, with nothing here saying so. A `locales` block, keyed by locale code, now describes as many as you like; `metadata` is the default for all of them and each entry overrides only what differs. Every configured locale is written, validated and reported on, and a locale present in App Store Connect but absent from the config is surfaced rather than left looking accounted for. The flat single-locale form is unchanged.

## 2.0.0

`appstore-release` becomes an installable product rather than a directory you had to `cd` into. It now ships as an npm package with a CLI, an MCP server and a library API, all over one core.

### Breaking

| Change                                                                             | Who it affects                 | What to do                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| `cd skills/appstore-release/scripts && node cli.mjs X` → `npx appstore-release X`  | plugin and skill users         | use the binary; there is no shim                                |
| Relative config paths resolve against the config file, not the process directory   | anyone who ran from `scripts/` | this _is_ the fix — paths now mean what the config author meant |
| Default config name `config.json` → `appstore.config.json`                         | new users only                 | the old name is still discovered                                |
| Node 18 → 20.11                                                                    | anyone on 18                   | 18 is end-of-life                                               |
| Exit codes `0/1` → an eight-code table                                             | anyone scripting `== 1`        | see below, or use `--exit-zero`                                 |
| `createContext(requireAppId, requireConfig)` → `createContext(options)`, now async | no published consumers         | —                                                               |

`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_P8_PATH`, `ASC_APP_ID` and `APPSTORE_CONFIG` all still work. They are one source of credentials now rather than the only one.

Exit codes: `0` ok · `1` internal error · `2` usage · `3` config/credentials · `4` blocked but fixable · `5` only a human in App Store Connect can finish · `6` App Store Connect refused after retries · `7` confirmation required.

### Fixed

- **Screenshot and subscription image uploads were silently broken in 1.0.0.** The commit step PATCHed a path without the `/v1` prefix, so every asset stayed reserved and invisible — the usual cause of a subscription stuck in `MISSING_METADATA` with nothing in the UI to explain it. (Also released as 1.0.1.)
- **`credentials` issued a new distribution certificate on every run.** Apple caps an account at three and there was no revocation path, so three runs left you unable to build. It now reuses a certificate whose private key you already hold, and refuses the last slot without `--allow-new-cert`. Adds `--list` and `--revoke`.
- **`screenshots` deleted every remote screenshot before uploading.** A failure partway through left the listing with fewer screenshots than it started with. It now diffs against the checksum App Store Connect stores and uploads only what changed. Screenshots stuck mid-upload are detected and replaced.
- **`subscription` deleted and recreated an identical price and review screenshot on every run.**
- **`metadata` PATCHed every field unconditionally** and always reported a change. Its first-version test was also wrong, so `whatsNew` was never sent for an actual update.
- **`--build` was documented but never parsed** — the flag had no effect at all.
- **`credentials` was excluded from config loading** but required `config.bundleId`, so it always failed.
- **A missing editable version silently targeted the live one.** It now reports that no editable version exists.
- **`--json` interleaved human text with the JSON** on the same stream, so it could not be piped.
- Config paths, `credentials.json` included, resolved against the process directory — which, following the old instructions, meant writing a secret into the installed plugin's own tree.
- User-controlled config values were interpolated into `openssl` shell command lines.
- Emoji in the description was reported as a warning; App Store Connect rejects it outright.

### Added

- **MCP server** — 10 outcome-shaped tools and 6 resources over stdio, for any MCP-speaking agent. `asc_readiness_report` is the one to start from. Every mutating tool requires `confirm: true`; `asc_submit_for_review` refuses unless the app is actually ready; credentials never enter tool arguments.
- **Readiness report** — `check` returns a verdict, findings and an ordered plan as structured data, rendered as text, JSON or markdown. Each finding says who can fix it and how, and distinguishes "Apple has no API for this" from "we have not automated it yet".
- **`--dry-run`**, enforced at the HTTP client so no operation can forget it.
- **Published JSON Schema** for the config, with `init`, `schema` and `validate` commands that need no credentials.
- **`doctor`** — verifies credentials, key role, `openssl` and config without touching app data.
- **Library API** — `createContext`, `runOperation`, `runPipeline`, `getReadinessReport`, `listOperations`.
- `ASC_P8` carries the private key inline, for CI and MCP hosts that cannot write a `.p8` to disk.
- Retry with jitter, `Retry-After`, timeouts and real pagination. POST is never retried after a connection drop.
- Local PNG validation with no `sips`, so screenshot checks work on any OS.
- 72 tests, type checking, and CI across Node 20/22/24 on Linux and macOS.

## 1.0.1

- Fixed the asset commit path (`/v1` prefix), which broke every screenshot and subscription image upload.

## 1.0.0

- Initial release as a Claude Code plugin and agent skill.
