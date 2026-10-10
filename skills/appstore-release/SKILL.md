---
name: appstore-release
description: Ship an iOS app to App Store review end to end over the App Store Connect API — build attach, metadata, screenshots, pricing, age rating, content rights, review info, subscriptions and the review submission, driven by a readiness report that says what to do next. Use when the user says "publish/submit my app", "send it to App Review", "ship the iOS app", "release a new version", "fill out App Store Connect", "upload metadata", "why can't I submit", or "automate App Store Connect". Works for any app given an App Store Connect API key, an app id and a config file. Hands focused work to app-store-preflight, app-store-screenshot-upload, app-store-age-rating, app-store-subscriptions, app-store-testflight, app-store-rejection, app-store-customer-reviews and ios-code-signing.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com. Needs an App Store Connect API key with the App Manager role. git is used once to fetch the CLI when the skill runs outside a checkout.
metadata:
  author: Furkan Beydemir
  version: "4.3.0"
  guidelines: "2026-06-08"
---

# App Store Release

> **You say:** _"Publish my app for review."_ · _"Why can't I submit this version?"_
>
> **It does:** Checks the app itself for what App Review rejects, reads it from App Store Connect, lists what blocks review in the order to fix it, fixes everything the API allows — build, metadata in every language, screenshots, price, age rating, subscriptions — and submits only when nothing is in the way. For what Apple keeps in its web UI, it gives the exact clicks.

Drive an entire iOS App Store submission through the App Store Connect API. The user provides credentials and a config **once**; you do everything automatable and interrupt them only for what Apple genuinely keeps out of the API — the App Privacy questionnaire, and, if App Store Connect refuses it by API, an app's first subscription or in-app purchase.

## Operating principle

1. **Let `check` decide what to do.** It returns a verdict and an ordered list of next actions, each labelled as something the tool can fix or something only a human in App Store Connect can. Do not plan the sequence yourself — read it.
2. **Config-driven, not prompt-driven.** All app content lives in the config. Run commands; do not interview the user about things the config already answers.
3. **Ask about content, not about schema.** Paid or free, mature content, iPad support, languages — ask in the user's terms, then write the config yourself. `asc schema` prints the exact shape.
4. **Ask the user only when** a field is missing (say exactly which), a business decision is not in the config (price, release timing), or before the one irreversible action: the final submit.
5. **Everything is idempotent.** `release` is safe to re-run; a second run with nothing changed sends nothing.

## Running the CLI

Every command goes through the launcher inside this skill:

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from — for example `.claude/skills/appstore-release`, `~/.agents/skills/appstore-release`, or `${CLAUDE_PLUGIN_ROOT}/skills/appstore-release`. The launcher finds the CLI by itself (plugin install, repository checkout, or a one-time `git clone` pinned to this skill's version into `~/.cache/appstore-release`). If it says it is cloning, tell the user once. Set `APPSTORE_RELEASE_HOME` to use a specific checkout.

Below, `asc <command>` is shorthand for that line. Run it from the user's project directory — relative paths in the config resolve against the config file, so never `cd` first. Add `--json` for one machine-readable document on stdout; `asc <command> --help` lists that command's own flags.

## Setup

See [references/setup.md](references/setup.md). In short:

```bash
export ASC_KEY_ID=...            # 10 characters
export ASC_ISSUER_ID=...         # a UUID
export ASC_P8_PATH=/abs/AuthKey_XXXXXXXXXX.p8    # or ASC_P8 with the PEM inline
export ASC_APP_ID=1234567890     # digits from the App Store Connect URL, NOT the bundle id
```

Never put the key id, issuer id or `.p8` into a tool argument or a file you commit. They come from the environment only.

No config yet? `asc init` writes `appstore.config.json` with a `$schema`; fill it from what the user tells you ([references/config-template.json](references/config-template.json) shows every block). `asc validate` checks it offline, without credentials.

**Expo project?** Its `store.config.json` (EAS Metadata) is used as is: on its own it is the config, or name it with `"easMetadata": "./store.config.json"` and add only what EAS Metadata cannot say — screenshots, price, subscriptions, content rights. The app id comes from eas.json's `ascAppId` and the bundle id from app.json, so `ASC_APP_ID` can be left unset.

## Runbook

### 0. Preflight the app itself

```bash
asc preflight   # offline, no credentials: Info.plist, privacy manifest, code
```

Permission texts, required-reason codes, account deletion, Sign in with Apple, restore purchases — the rejections that live in the app, not the listing. Anything certain to be rejected needs a code change and a new build, so do this before building. Details: **app-store-preflight**.

### 1. Orient

```bash
asc doctor      # credentials, openssl, config — touches no app data
asc check       # the verdict and the ordered plan
```

`check` includes the preflight findings as its first section, **App**.

`verdict` is one of `ready`, `blocked`, `needs-human`, `in-review`, `approved`, `rejected`, `live`. Exit codes: `0` ready · `4` blocked but fixable by this tool · `5` only a human in App Store Connect can finish · `8` still in review after `check --wait`.

### 2. Route by finding

Work through `nextActions` in order. When a finding belongs to a focused area, load that skill — it carries the detail this one leaves out:

| Finding ids / situation                                                | Skill or reference                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `app.*`, "will Apple reject it", permission texts, privacy manifest    | **app-store-preflight**                                                  |
| `screenshots.*`, "make screenshots", iPhone Duo, iPad sizes            | **app-store-screenshot-upload**                                          |
| `rating.*`, "what age rating", social media / loot box answers         | **app-store-age-rating**                                                 |
| `subscription.*`, `iap.*`, plans, free trials, lifetime unlock         | **app-store-subscriptions**                                              |
| "send it to TestFlight", testers, beta groups, What to Test            | **app-store-testflight**                                                 |
| "reply to reviews", bad reviews, "what are people saying"              | **app-store-customer-reviews**                                           |
| verdict `rejected`, `submission.rejected`, "Apple rejected it"         | **app-store-rejection**                                                  |
| `version.build.*` with an EAS signing error, expired profile           | **ios-code-signing**                                                     |
| `metadata.*`, `config.*.emoji`, `.too-long`, `.placeholder`, `.wasted` | [references/metadata.md](references/metadata.md)                         |
| "accessibility labels", VoiceOver, Larger Text on the App Store        | [references/accessibility.md](references/accessibility.md)               |
| promotional offers, offer codes, "discount for lapsed subscribers"     | **app-store-subscriptions**                                              |
| app preview videos                                                     | **app-store-screenshot-upload**                                          |
| custom product pages, "a landing page for our campaign"                | [references/custom-product-pages.md](references/custom-product-pages.md) |
| sales, downloads, analytics, "A/B test the screenshots"                | [references/reports-and-tests.md](references/reports-and-tests.md)       |
| TestFlight feedback, tester crashes                                    | **app-store-testflight**                                                 |
| `account.credentials.*`, `config.missing`                              | [references/setup.md](references/setup.md)                               |
| any 409 you do not recognise                                           | [references/gotchas.md](references/gotchas.md) — read it before guessing |

If a focused skill is not installed, the reference files here and `asc <command> --help` are enough to proceed.

### 3. Open a version, if none is editable

`check` reports `version.none` when every version is already live:

```bash
asc new-version          # infers the next number
asc new-version 1.2.0    # or name it
```

### 4. Build the binary (Expo/EAS)

Only when `check` reports no build:

```bash
eas build -p ios --profile production --non-interactive --no-wait
eas submit -p ios --profile production --id <buildId>
asc attach-build                   # newest VALID build; or --build <number>
```

Signing failures (_"Provisioning Profile has expired"_, _"No certificate exists with serial…"_) belong to **ios-code-signing**. Builds made with the iOS 27 SDK must ship a launch screen (`UILaunchScreen` or a launch storyboard) and adopt the scene lifecycle, or Apple rejects them; from April 2027 every upload must be built with Xcode 27.

### 5. Fill the listing

```bash
asc release --dry-run    # show the user exactly what would change
asc release              # apply it, then a fresh check
```

`release` runs attach-build, metadata, pricing, content-rights, age-rating, category, accessibility, review-info, release-options, screenshots, previews, custom-product-pages, experiments, subscription and in-app-purchases — each one idempotent, each skipped when the config says nothing about it. Run any of them alone by name.

**Notes for the reviewer.** `asc review-info --draft-notes` drafts them — sign-in, how to reach the main feature, the permissions and what they are for, the products — from the config and the app. It writes nothing. Show the draft to the user, fill in what it leaves in parentheses, put the result in `review.notes`, then `asc review-info`. `check` warns `review.demo.likely-needed` when the app has sign-in and App Review has no way in.

Screenshots from a generator? Point `"screenshots": { "from": "./exports" }` at its output folder: every PNG is grouped into device sets by pixel size.

### 6. Hand off what Apple keeps in the UI

**App Privacy → Data Collection.** Apple has no API for it. Ask the user to declare the data types matching the app's privacy manifest and press **Publish** (App Store Connect → the app → App Privacy). Then record that they did, so the readiness report can reach `ready`:

```json
"review": { "privacyPublished": true }
```

The API cannot verify this flag — only set it when the user confirms. If Publish is greyed out, see "NSUserTracking conflict" in [references/gotchas.md](references/gotchas.md#app-privacy-ui-only).

**Nothing else**, unless App Store Connect refuses a first product. **The app's first subscription or in-app purchase** (`subscription.first.with-version`, INFO). It goes to review with the version, and `asc submit` sends it by API in the same submission. If App Store Connect refuses, `submit` exits 5 with nothing submitted and the clicks: version page → In-App Purchases and Subscriptions → Select → the product → Add for Review → Submit to App Review. Relay them — or, if the user prefers, `asc submit --submit --skip-products` sends the app alone and the products wait for the next version.

### 7. Submit

```bash
asc check
asc submit --submit
```

**Ask the user before running it.** `submit` computes the readiness report first and refuses unless the verdict is `ready`. Configured subscriptions and in-app purchases are submitted together with the version, first ones included (step 6). Show the user the list from `asc submit --submit --dry-run` before the real one. If the user insists on submitting with blockers, `--force` exists; tell them Apple will reject it. Afterwards `asc status` should show the version as `WAITING_FOR_REVIEW`. A queued submission is not an approval: report what you can verify, nothing more.

To follow the review: `asc check --wait 30` re-checks while the version is in review (exit `0` approved, `5` rejected, `8` still waiting). Review usually takes hours — prefer checking again later over waiting long.

On rejection, switch to **app-store-rejection**: the fix, then `asc submit --submit --resolved`.

## MCP

The same core is an MCP server (`asc mcp`, 13 tools). Start with `asc_readiness_report`; `asc_validate_config` with `preflight: true` checks the app offline. Every mutating tool needs `confirm: true`, and `asc_submit_for_review` refuses unless the report is `ready`. In `nextActions`, `mutates: true` marks a command that writes to App Store Connect — ask before running it.

## References

- [references/setup.md](references/setup.md) — API key, app record, secrets hygiene.
- [references/metadata.md](references/metadata.md) — fields, limits, locales, what Apple rejects.
- [references/gotchas.md](references/gotchas.md) — every pitfall hit in practice, with exact error text.
- [references/accessibility.md](references/accessibility.md) — Accessibility Nutrition Labels, per device.
- [references/custom-product-pages.md](references/custom-product-pages.md) — campaign pages with their own text, media and deep link.
- [references/reports-and-tests.md](references/reports-and-tests.md) — sales, analytics reports and product page tests.
- [references/config-template.json](references/config-template.json) — a complete config, validated against the published schema.
- [references/screenshots.md](references/screenshots.md) — screenshot essentials (full guide in **app-store-screenshot-upload**).

_Checked against the App Store Review Guidelines of June 8, 2026._
