# Checklists by kind of app

Walk the one that matches the app with the user. Each line is something App Review checks by hand; the guideline number is there so a rejection can be traced back to it. Checked against the App Store Review Guidelines of June 8, 2026.

## Every app

- [ ] Every permission prompt says what the data is used for, in the user's terms (5.1.1(ii)).
- [ ] The app works on a fresh install with no prior state; nothing is a placeholder or "coming soon" (2.1).
- [ ] If anything is behind a login, App Review has a demo account that works and the notes say how to reach the main feature (2.1).
- [ ] The privacy policy URL loads and describes this app's data use (5.1.1(i)).
- [ ] App Privacy in App Store Connect matches what the app and its SDKs collect (5.1.2).
- [ ] No other platform named in the metadata: "Android", "Google Play" (2.3.10).

## Subscriptions and in-app purchases (3.1.1, 3.1.2)

- [ ] Digital content and features are sold only with In-App Purchase.
- [ ] The paywall shows the price and billing period most prominently; a trial says how long it lasts and what is charged after.
- [ ] The paywall links to the Terms of Use (EULA) and the privacy policy — in the app, and in the App Store metadata (description link or a custom EULA).
- [ ] Restore Purchases is reachable without buying anything.
- [ ] Nothing paid in the subscription is something the free app already gave.
- [ ] The subscription keeps delivering value for its whole period (3.1.2(a)).

## Sign-in and accounts (4.8, 5.1.1(v))

- [ ] Third-party or social sign-in for the main account is offered alongside an option that limits data to name and email, lets the user keep their email private, and does not track for ads — Sign in with Apple meets this. Exempt: the company's own account system only, education or enterprise accounts, government or industry ID, or a client for one specific third-party service.
- [ ] An account created in the app can be deleted from inside the app — deletion, not deactivation; if a website step is needed, the app links straight to it.
- [ ] The app does not require sign-in for features that do not need an account (5.1.1(v)).

## User-generated content (1.2)

- [ ] A way to report offensive content and abusive users, acted on in time.
- [ ] A way to block abusive users.
- [ ] Published contact information.
- [ ] A filter for objectionable material before it is posted.

## Kids Category (1.3)

- [ ] No third-party analytics or advertising, except as the guideline allows.
- [ ] Links out, purchases and permission requests sit behind a parental gate.

## Health, medical and fitness (1.4.1, 5.1.3)

- [ ] Claims of accuracy are backed; a medical app discloses its methodology.
- [ ] HealthKit data is not used for advertising or stored in iCloud.

## AI features (5.1.2(i), 1.2)

- [ ] Personal data sent to a third-party AI service is disclosed, and the user agrees first.
- [ ] Generated content can be reported, like user-generated content.

## Tracking (5.1.2(i))

- [ ] App Tracking Transparency is asked before any tracking; the app works the same if the user declines.
- [ ] `NSUserTrackingUsageDescription` says what is tracked and why.
