---
name: app-store-preflight
description: Check an iOS app for what App Review rejects before it is submitted — reads the project itself (Expo app.json, Info.plist, INFOPLIST_KEY_ build settings, PrivacyInfo.xcprivacy, source) offline and reports missing or generic permission texts, invalid required-reason codes, login without an equivalent private option, no in-app account deletion, external payments, no restore purchases, tracking without ATT, insecure HTTP, secrets in the bundle. Use when the user asks "will Apple reject my app", "check my app before I submit", "App Store review checklist", "preflight", "guideline 5.1.1 / 4.8 / 3.1.1 / 3.1.2", "privacy manifest", "ITMS-91053", "purpose string", or before a first submission.
license: MIT
compatibility: Node.js 20.11+. Works offline with no App Store Connect credentials; reads the project directory only. --expo-config runs `npx expo config` in the project.
metadata:
  author: Furkan Beydemir
  version: "4.3.2"
  guidelines: "2026-06-08"
---

# App Store preflight

> **You say:** _"Will Apple reject my app?"_ · _"Check my app before I submit."_
>
> **It does:** Reads the app's own project — config, Info.plist, privacy manifest, code — with no credentials, and lists what App Review is certain or likely to reject, each with the guideline, the file and line, and the fix. Then it lists what only a test on a device can prove.

App Store Connect only sees the listing. The most common rejections are in the app: a permission prompt with no reason, accounts that cannot be deleted, a paywall with no restore. This skill finds them before a review cycle is spent.

## Running the CLI

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from. Below, `asc` means that line. Run it from the app's directory, or point at it with `--project-root`.

## 1. Run it

```bash
asc preflight                       # the project next to the config, or the current directory
asc preflight --project-root ./app  # somewhere else
asc preflight --expo-config         # also evaluate app.config.js/ts (runs `npx expo config`)
asc preflight --json                # one document: findings, notes, manualChecks, signals
```

No credentials, no network. Exit `4` when something is certain to be rejected, `0` otherwise. The same findings appear first in `asc check`, under **App**.

Only use `--expo-config` when the project has a dynamic `app.config.js/ts` (preflight says so with `app.expo-config.dynamic`): it executes the project's config code.

## 2. Read it as a risk table

Present the result to the user in this order, one line each, with the evidence:

| Priority | What                                          | Severity in the output    |
| -------- | --------------------------------------------- | ------------------------- |
| P0       | Certain rejection — fix before submitting     | `blocker`                 |
| P1       | Likely rejection — inferred from code or deps | `warning`                 |
| P2       | Worth knowing                                 | `info`                    |
| P3       | Waived, with the reason on record             | `info`, `Ignored:` prefix |

Evidence is `file:line` or the Info.plist key and where it comes from. A warning is a text search or a dependency, not proof — say "found X, not found Y" rather than "your app has no account deletion". If you cannot point at evidence, label the item **Unverified**.

## 3. Fix, or waive with a reason

| Finding id                              | Guideline | Fix                                                                                              |
| --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `app.permission.missing.<Key>`          | 5.1.1(ii) | Add the key. Expo: the plugin option the finding names, in `expo.plugins`                        |
| `app.permission.default-text.<Key>`     | 5.1.1(ii) | Say what the app does with it and why it helps the user — not "Allow X to access your camera"    |
| `app.privacy-manifest.invalid-reason.*` | —         | Use a valid reason code for the category; App Store Connect refuses the upload otherwise         |
| `app.privacy-manifest.missing`          | —         | Bare iOS: add `PrivacyInfo.xcprivacy`. Expo: only if your own code calls a required-reason API   |
| `app.login.equivalent-option`           | 4.8       | Add Sign in with Apple, or record the exemption that applies                                     |
| `app.account-deletion`                  | 5.1.1(v)  | An in-app path that deletes the account, not only signs out                                      |
| `app.payments.external`                 | 3.1.1     | Digital goods through In-App Purchase; physical goods and services may use other payment         |
| `app.subscription.restore`              | 3.1.2     | A Restore Purchases button                                                                       |
| `app.tracking.prompt`                   | 5.1.2(i)  | App Tracking Transparency before tracking, or configure the SDK not to track                     |
| `app.ats.insecure`                      | —         | `https://`, or an exception scoped to one domain                                                 |
| `app.secrets.*`                         | —         | Move the secret to a server and rotate it                                                        |
| `app.export-compliance`                 | —         | Expo: `ios.config.usesNonExemptEncryption: false` when the app only uses HTTPS and system crypto |

A finding that does not apply is waived in the config, with a reason — the reason is required and stays visible:

```json
"preflight": {
  "ignore": [{ "id": "app.account-deletion", "reason": "Accounts are created and deleted on our website; the app only signs in." }]
}
```

An id waives itself and every id under it (`app.permission.default-text` covers every key). Ask the user before waiving anything; never waive a `blocker` to get past `check`.

Then run `asc preflight` again until nothing is P0.

## 4. Test what a static read cannot prove

The output ends with **Test on a device**: trigger every permission prompt and read it, create and delete an account, buy in the sandbox and restore, sign in with the demo account App Review will use. Give the user that list; a clean preflight does not mean these work.

## 5. Checklists by kind of app

Subscriptions, user-generated content, kids, health, AI features, sign-in: see [references/checklists.md](references/checklists.md). Walk the one that matches the app with the user before the first submission.

## Next

The listing side — metadata, screenshots, price, rating, submission — is the **appstore-release** skill. For the reviewer, `asc review-info --draft-notes` drafts the App Review notes from the config and what preflight read.

_Checked against the App Store Review Guidelines of June 8, 2026._
