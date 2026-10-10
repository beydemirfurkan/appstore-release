---
name: asc-rejection
description: Recover from an App Store rejection — read what App Review said, map the guideline to a concrete fix (metadata, screenshots, binary, age rating, subscriptions, review notes), apply it through the App Store Connect API, reply, and resubmit. Use when the user says "Apple rejected my app", "guideline 2.1 / 2.3 / 4.0 / 5.1.1 / 3.1.1", "metadata rejected", "binary rejected", "how do I respond to App Review", "resubmit", or when an App Store readiness check reports the rejected verdict.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager). Reading the rejection text needs the user, because Apple has no API for it.
metadata:
  author: Furkan Beydemir
  version: "2.1.0"
---

# Rejection → fix → resubmit

A rejection is a to-do list from App Review. The loop: **read it → classify it → fix the right layer → reply → resubmit**. Never resubmit unchanged hoping for a different reviewer.

## Running the CLI

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from. Below, `asc` means that line. Credentials come from the environment only.

## 1. Confirm the state

```bash
asc check
```

Verdict `rejected` (finding `submission.rejected`) means the version is editable again. `METADATA_REJECTED` means only the listing needs to change — no new build. `REJECTED` usually means the binary.

## 2. Get the message — the user has to

The rejection text lives in App Store Connect → the app → **App Review** (Messages). Apple exposes no API for it. Ask the user to paste the full message, including the guideline numbers and any screenshots the reviewer attached.

## 3. Classify and fix

Map each cited guideline with [references/guidelines.md](references/guidelines.md). Then fix at the right layer:

| Layer         | Examples                                                     | How                                                           |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| Listing       | description, keywords, screenshots, name, subtitle           | Edit the config → `asc release --dry-run` → `asc release`     |
| Age rating    | rating too low for content                                   | **asc-age-rating** skill → `asc age-rating`                   |
| Subscriptions | paywall terms, missing links                                 | **asc-subscriptions** skill; paywall changes need a new build |
| Review info   | reviewer could not log in, could not find a feature          | `review.notes`, demo account → `asc review-info`              |
| App Privacy   | data use mismatch                                            | User edits App Privacy in App Store Connect and republishes   |
| Binary        | crash, broken feature, missing account deletion, private API | Fix the code → new build (`eas build`) → `asc attach-build`   |

For a binary fix the version number can stay; the **build number** must increase.

## 4. Reply in App Store Connect

Draft the reply for the user to paste under the rejection in App Review. Keep it short and factual:

> Thank you for the review. We addressed guideline 2.1: the sign-in issue was caused by an expired demo password; the demo account in App Review Information is updated and verified. We also added step-by-step instructions to the review notes. Build 1.2.0 (43) contains no other changes.

If the user believes the rejection is wrong, say so politely with specifics, or suggest the App Review Board appeal (developer.apple.com/contact/app-store/?topic=appeal) — never argue in the listing.

## 5. Resubmit

```bash
asc check            # must be ready again
asc submit --submit  # ask the user first
```

## Avoiding the next one

- Put a working demo account and exact steps in `review.notes` whenever anything is behind a login.
- Account creation in the app ⇒ account deletion in the app (5.1.1(v)).
- Third-party sign-in ⇒ offer Sign in with Apple or an equivalent privacy-preserving option (4.8).
- Screenshots and description must match the build under review (2.3).
