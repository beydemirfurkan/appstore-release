---
name: asc-subscriptions
description: Get an iOS auto-renewable subscription ready for App Review and submitted with the app version through the App Store Connect API — group and subscription localizations, price at Apple's nearest price point, the paywall review screenshot, and the versioned submission (ASC API 4.4.1) that lets even a first subscription go through the API. Use when the user says "set up my subscription", "subscription is missing metadata", "submit the in-app purchase", "subscription stuck in READY_TO_SUBMIT", "paywall screenshot", "change subscription price", or when an App Store readiness check reports subscription.* findings.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager). The subscription product itself must already exist in App Store Connect.
metadata:
  author: Furkan Beydemir
  version: "3.0.0"
---

# Subscriptions

A subscription leaves `MISSING_METADATA` only when four things exist: a **group localization** (display name), a **subscription localization** (name and description), a **price**, and a **review screenshot** of the paywall. Then it is submitted for review **together with an app version** — Apple requires the first subscription of a group to ride with a version, in the same submission.

## Running the CLI

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from. Below, `asc` means that line. Credentials come from the environment only.

## 1. Prerequisites the user does once

- The subscription **group** and **product** exist in App Store Connect (Monetization → Subscriptions), with a product id the app's code uses. Ask for the product id; do not invent one.
- The **Paid Apps Agreement** is active (Business → Agreements). Without it, nothing can be priced or sold.
- The app's code uses StoreKit 2 (or RevenueCat, etc.) with that product id, and the paywall shows price, period, what it unlocks, auto-renewal terms, and links to the terms of use and privacy policy (guideline 3.1.2).

## 2. Configure

```json
"subscription": {
  "productId": "app_monthly",
  "groupDisplayName": "Premium",
  "localeName": "Monthly Premium",
  "localeDescription": "Unlock every feature.",
  "priceTerritory": "USA",
  "priceAmount": 4.99,
  "reviewScreenshot": "./assets/paywall.png"
}
```

- `priceAmount` is matched to Apple's nearest price point in `priceTerritory`; the result is reported. Only that territory's price is set — Apple equalizes the others. Prices in other territories set by hand are left alone.
- `reviewScreenshot` is a capture of the paywall (any iPhone screenshot size, no alpha). See the **asc-screenshots** skill for producing it.
- Localizations are written for the config's `locale` from `localeName` / `localeDescription` / `groupDisplayName`, and for every locale in `subscription.localizations` (`{ "tr": { "name": "…", "description": "…", "groupName": "…" } }`), which inherits what it leaves out. A changed name is updated, not only created.

## 3. Apply

```bash
asc subscription --dry-run
asc subscription
asc check          # subscription.missing-metadata should be gone; state READY_TO_SUBMIT
```

## 4. Submit with the version

```bash
asc submit --submit      # ask the user first — this is irreversible
```

`submit` builds one review submission containing the `appStoreVersion`, the `subscriptionGroupVersion` and the `subscriptionVersion` (the versioned model from ASC API 4.4.1), then submits it. That is what makes a **first** subscription possible without the App Store Connect UI. Later subscriptions in the same group can be submitted the same way, with or without a version.

Afterwards `asc status` should show the version and the subscription as `WAITING_FOR_REVIEW`.

## Common rejections

| Guideline | What Apple says                                  | Fix                                                                                                                   |
| --------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 3.1.2     | Missing terms / privacy links or renewal terms   | Add them to the paywall **and** the description (EULA link in the description or a custom EULA in App Store Connect). |
| 3.1.1     | Digital content unlocked without in-app purchase | Route all digital unlocks through StoreKit; no external payment links (outside allowed regions).                      |
| 2.1       | Reviewer could not find or buy the subscription  | Explain where the paywall is in `review.notes`; make sure products load in the sandbox.                               |
| 3.1.2(a)  | Subscription does not provide ongoing value      | Subscriptions must unlock continuing content or service; use a non-consumable for one-time unlocks.                   |

## Gotchas

- Products not loading in review usually means the Paid Apps Agreement is not active, or the product is still `MISSING_METADATA`.
- Subscription changes after approval (price, localizations) go through review again with the next submission.
- The old API had no `subscription` relationship on `reviewSubmissionItems` (409 _`'subscription' is not a relationship`_) — that is why older guides send people to the UI. The versioned model replaced it.
- Introductory offers, promotional offers and offer codes are configured in App Store Connect; this tool does not manage them yet.
