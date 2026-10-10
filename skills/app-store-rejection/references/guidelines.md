# Common rejections, mapped to fixes

Guideline text: <https://developer.apple.com/app-store/review/guidelines/> (last updated June 8, 2026). These are the ones that recur; the fix column says which layer changes. Many binary ones can be caught before submitting with `asc preflight`.

| Guideline             | Typical message                                                             | Fix                                                                                                             | Layer                       |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 2.1 Completeness      | App crashed, a feature did not work, placeholder content, could not sign in | Reproduce on the reviewer's device/OS; fix; provide a demo account and steps in `review.notes`                  | Binary / review info        |
| 2.1 (IAP)             | In-app purchases could not be found or failed to load                       | Products `READY_TO_SUBMIT` and submitted with the version; Paid Apps Agreement active; say where the paywall is | Subscriptions / review info |
| 2.3.3                 | Screenshots do not reflect the app in use                                   | Re-capture real screens; captions are fine, invented UI is not                                                  | Listing (screenshots)       |
| 2.3.7                 | Inaccurate or irrelevant keywords/name; competitor names; price in name     | Clean the keywords and name                                                                                     | Listing (metadata)          |
| 2.3.8                 | Metadata not appropriate for the age rating                                 | Align listing with the rating, or raise the rating                                                              | Listing / age rating        |
| 2.3.10                | Other platforms named in the metadata ("Android", "Google Play")            | Remove them; `check` flags `config.*.other-platform`                                                            | Listing (metadata)          |
| 2.5.1                 | Uses non-public APIs                                                        | Remove the private API usage; often an outdated SDK                                                             | Binary                      |
| 3.1.1                 | Digital content unlocked without in-app purchase / external payment link    | Use StoreKit for digital goods; remove external purchase prompts (outside allowed storefronts)                  | Binary                      |
| 3.1.2                 | Subscription terms missing                                                  | Paywall shows price, period, auto-renewal, terms and privacy links; same in the description                     | Binary + listing            |
| 4.0 Design            | Minimal functionality, web wrapper, poor UI                                 | Add native value; explain in the reply what the app does beyond the website                                     | Binary                      |
| 4.2                   | Minimum functionality / spam / template app                                 | Differentiate; rarely fixable by metadata alone                                                                 | Binary                      |
| 4.3                   | Spam: one of many similar apps, or a copy of a template                     | The hardest to come back from: a materially different app, or merge into one; a reply alone rarely works        | Binary                      |
| 4.8                   | Third-party login without an equivalent privacy-preserving option           | Add Sign in with Apple (it qualifies), or explain the exemption that applies                                    | Binary                      |
| 5.1.1(ii)             | Purpose string does not explain the use of the data                         | Specific usage descriptions; `asc preflight` flags generic and missing ones                                     | Binary                      |
| 5.1.1(i)              | Privacy policy missing or inadequate                                        | Fix `privacyPolicyUrl` content; it must describe the data the app collects                                      | Listing                     |
| 5.1.1(v)              | Account creation without account deletion                                   | In-app account deletion that actually deletes                                                                   | Binary                      |
| 5.1.2                 | Tracking without App Tracking Transparency                                  | Request ATT before tracking, or stop tracking and remove `NSUserTrackingUsageDescription`                       | Binary + App Privacy        |
| 5.1.1 (privacy label) | App Privacy answers do not match observed data collection                   | User edits App Privacy in App Store Connect and republishes                                                     | App Privacy (UI only)       |
| Missing launch screen | Built with the iOS 27 SDK without `UILaunchScreen` / launch storyboard      | Add a launch screen; rebuild                                                                                    | Binary                      |

## Metadata-only rejections

`METADATA_REJECTED` keeps the build. Fix the listing with `asc release`, reply, and resubmit the same build — no `eas build` needed.

## When to appeal

Only when the rejection misreads the app and a clear reply has not helped. Appeals go to the App Review Board through Apple's contact form. Suggest it; never file it for the user without their say-so.
