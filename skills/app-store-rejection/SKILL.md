---
name: app-store-rejection
description: Recover from an App Store rejection — read what App Review said, map the guideline to a concrete fix (metadata, screenshots, binary, age rating, subscriptions, review notes), apply it through the App Store Connect API, reply, and resubmit. Use when the user says "Apple rejected my app", "guideline 2.1 / 2.3 / 4.0 / 5.1.1 / 3.1.1", "metadata rejected", "binary rejected", "how do I respond to App Review", "resubmit", or when an App Store readiness check reports the rejected verdict.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager). Reading the rejection text needs the user, because Apple has no API for it.
metadata:
  author: Furkan Beydemir
  version: "4.2.0"
  guidelines: "2026-06-08"
---

# Rejection → fix → resubmit

> **You say:** _"Apple rejected my app — what now?"_ · _"Resubmit after fixing guideline 2.1."_
>
> **It does:** Reads the rejection with you, maps the guideline to the layer that needs fixing — listing, screenshots, rating, products or binary — applies the fix, and resubmits.

A rejection is a to-do list from App Review. The loop: **read it → classify it → fix the right layer → reply → resubmit**. Classify before you touch anything: the wrong layer costs a whole review cycle. Never resubmit unchanged hoping for a different reviewer.

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

## 3. Classify, then fix the right layer

First, which kind of rejection it is:

```
version state METADATA_REJECTED?
├─ yes → the listing only. No new build.
│        edit the config → asc release --dry-run → asc release → reply → asc submit --submit --resolved
└─ no (REJECTED) → read the guideline:
     ├─ 2.3.x, 5.1.1(i) privacy policy URL → listing; the build may stay
     ├─ 2.1 "could not sign in / find the feature" → review info: demo account, steps in review.notes
     ├─ App Privacy answers don't match → the user edits App Privacy in App Store Connect
     └─ anything about what the app does → the binary: fix → new build number → asc attach-build
```

Map each cited guideline with [references/guidelines.md](references/guidelines.md). Then fix at the right layer:

| Layer         | Examples                                                     | How                                                                 |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Listing       | description, keywords, screenshots, name, subtitle           | Edit the config → `asc release --dry-run` → `asc release`           |
| Age rating    | rating too low for content                                   | **app-store-age-rating** skill → `asc age-rating`                   |
| Subscriptions | paywall terms, missing links                                 | **app-store-subscriptions** skill; paywall changes need a new build |
| Review info   | reviewer could not log in, could not find a feature          | `asc review-info --draft-notes`, demo account → `asc review-info`   |
| App Privacy   | data use mismatch                                            | User edits App Privacy in App Store Connect and republishes         |
| Binary        | crash, broken feature, missing account deletion, private API | Fix the code → `asc preflight` → new build → `asc attach-build`     |

For a binary fix the version number can stay; the **build number** must increase. Run `asc preflight` on the fixed project before building: it catches the next rejection of the same kind.

## 4. Reply in App Store Connect

Draft the reply for the user to paste under the rejection in App Review. Three short parts, facts only:

```
UNDERSTANDING
Guideline 5.1.1(v): the app lets people create an account but had no way to delete it.

CHANGES MADE
Settings → Account → Delete Account now deletes the account and its data on our server.
Build 1.2.0 (43) contains this change and nothing else.

HOW TO VERIFY
Sign in with the demo account in App Review Information, open Settings → Account,
tap Delete Account, confirm. Signing in again with the same account then fails.
```

If the user believes the rejection is wrong, say so politely with specifics — what the reviewer saw, what the app actually does — never argue in the listing.

**Appeal or expedite?** They are different requests:

- **Appeal** (App Review Board, developer.apple.com/contact/app-store/?topic=appeal) — the rejection misreads the app and a clear reply has not helped. Suggest it; never file it for the user.
- **Expedited review** (developer.apple.com/contact/app-store/?topic=expedite) — the fix is in, and a critical bug or a dated event makes waiting costly. It asks for speed, not a different verdict. Use it sparingly.

**Under pressure.** "It must go out today" does not change what App Review accepts: fix the cited issue, resubmit, and offer expedited review if the reason is real. A **third rejection** for the same guideline means the reply is not landing — re-read the message with the user, change the approach, and consider the appeal. A **4.3 (spam)** rejection is the hardest to reverse: it needs a materially different app, not new wording.

## 5. Resubmit

```bash
asc release                    # if the fix was metadata, screenshots, rating or products
asc submit --submit --resolved # ask the user first
```

`--resolved` is the user's word that what App Review asked for is addressed — the API cannot read Resolution Center to check. It resubmits the same review submission, marking its rejected items resolved. Without it, `submit` stops and says to read Resolution Center; with other blockers still open, it says to run `release` first.

A binary fix means a new build first (`eas build`, `eas submit`, then `asc attach-build`).

Then follow it: `asc check --wait 30` — exit `0` approved, `5` rejected again, `8` still in review.

## Avoiding the next one

- Put a working demo account and exact steps in `review.notes` whenever anything is behind a login.
- Account creation in the app ⇒ account deletion in the app (5.1.1(v)).
- Third-party sign-in ⇒ offer Sign in with Apple or an equivalent privacy-preserving option (4.8).
- Run `asc preflight` before every new build: these three are among what it checks.
- Screenshots and description must match the build under review (2.3).

_Checked against the App Store Review Guidelines of June 8, 2026._
