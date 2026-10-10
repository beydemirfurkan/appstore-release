---
name: asc-subscriptions
description: Get an iOS auto-renewable subscription ready for App Review and submitted with the app version through the App Store Connect API — group and subscription localizations, price at Apple's nearest price point, the paywall review screenshot, and submission — later subscriptions by API (versioned, ASC API 4.4.1), the app's first one from the App Store Connect website as Apple requires. Use when the user says "set up my subscription", "subscription is missing metadata", "submit the in-app purchase", "subscription stuck in READY_TO_SUBMIT", "paywall screenshot", "change subscription price", or when an App Store readiness check reports subscription.* findings.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager). The subscription product itself must already exist in App Store Connect.
metadata:
  author: Furkan Beydemir
  version: "3.2.0"
---

# Subscriptions

A subscription leaves `MISSING_METADATA` only when four things exist: a **group localization** (display name), a **subscription localization** (name and description), a **price**, and a **review screenshot** of the paywall. Then it goes to review with an app version. The app's **first** subscription is submitted from the App Store Connect website together with the binary — Apple's rule; every later one can be submitted by `asc submit`.

## Running the CLI

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from. Below, `asc` means that line. Credentials come from the environment only.

## 1. Prerequisites the user does once

- A **product id** the app's code uses. Ask for it; do not invent one. The plan and its group are created from the config when they do not exist yet (give `name` and `period`), or can be made by hand in App Store Connect (Monetization → Subscriptions).
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

### Several plans, a free trial, a lifetime unlock

```json
"subscriptions": [
  { "productId": "pro_monthly", "name": "Pro Monthly", "period": "ONE_MONTH", "group": "Pro", "groupLevel": 2,
    "localeName": "Pro Monthly", "priceAmount": 4.99, "reviewScreenshot": "./assets/paywall.png",
    "introOffer": { "type": "FREE_TRIAL", "duration": "ONE_WEEK" } },
  { "productId": "pro_yearly", "name": "Pro Yearly", "period": "ONE_YEAR", "group": "Pro", "groupLevel": 1,
    "localeName": "Pro Yearly", "priceAmount": 39.99, "reviewScreenshot": "./assets/paywall.png" }
],
"inAppPurchases": [
  { "productId": "lifetime", "name": "Lifetime", "localeName": "Lifetime access",
    "localeDescription": "Every feature, forever.", "priceAmount": 79.99, "reviewScreenshot": "./assets/paywall.png" }
]
```

- `subscriptions` (a list) replaces `subscription` (one object); each entry has the same fields. A plan or group that does not exist is created from `name`, `period` and `group`. Same group = the user can switch between plans; `groupLevel` 1 is the top tier.
- `introOffer`: `FREE_TRIAL` (no price), `PAY_AS_YOU_GO` (`periods` × discounted price) or `PAY_UP_FRONT`, with a `duration` from `THREE_DAYS` to `ONE_YEAR`. Paid offers are priced in `priceTerritory` only. An existing offer of the same shape is left alone.
- `inAppPurchases`: one-time purchases, `NON_CONSUMABLE` (a lifetime unlock) by default. Created when missing, then localized, made available everywhere, priced, and given its review screenshot. `asc in-app-purchases` runs them alone.

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

**First subscription of the app?** `check` reports `subscription.first.ui-only`. Apple requires it to be submitted from the website with the binary: version page → In-App Purchases and Subscriptions → Select → the product → Add for Review → Submit to App Review. Do not try to work around it.

**Any later subscription or in-app purchase:** `submit` adds its version (`subscriptionVersion`, `inAppPurchaseVersion` — the versioned model from ASC API 4.4.1) to the same review submission as the `appStoreVersion`, then submits. The app's **first in-app purchase** follows the same rule as its first subscription: website, with the binary (`iap.first.ui-only`).

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
