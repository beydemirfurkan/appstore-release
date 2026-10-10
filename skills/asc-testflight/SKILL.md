---
name: asc-testflight
description: Put an iOS build in front of TestFlight testers through the App Store Connect API — export compliance, What to Test notes, internal and external beta groups, inviting testers by email, the beta app description and beta review contact, and submitting for beta app review. Use when the user says "send it to TestFlight", "add testers", "invite beta testers", "create a beta group", "what to test", "external testing", "beta review", "missing export compliance", or wants a build tested before App Store review.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager or Admin). The build must already be uploaded and processed (eas submit, Xcode or Transporter).
metadata:
  author: Furkan Beydemir
  version: "3.1.0"
---

# TestFlight

Getting a build to testers is its own decision, separate from the App Store listing, so it is its own command: `testflight`. It reads a `testflight` block from the config and writes only what differs, so it is safe to re-run after every new build.

## Running the CLI

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from. Below, `asc` means that line. Credentials come from the environment only.

## 1. Describe it in the config

```json
"testflight": {
  "whatToTest": "The new streaks screen and reminders.",
  "groups": [{ "name": "Team", "internal": true }, "Beta"],
  "testers": [{ "email": "friend@example.com", "group": "Beta" }],
  "description": "Wellness helps you keep small habits.",
  "feedbackEmail": "beta@example.com",
  "usesNonExemptEncryption": false
}
```

- **Groups.** A string is an external group; `{ "internal": true }` is an internal one. Internal testers must be App Store Connect users and need no review. External testers are anyone with an email, after Apple's beta app review.
- **`whatToTest`** is one string for the config's locale, or an object keyed by locale.
- **`description` and `feedbackEmail`** are required before external testing. The beta review contact comes from the config's `review` block.
- **`usesNonExemptEncryption`.** A build waits in `MISSING_EXPORT_COMPLIANCE` until this is answered. Ask the user; most apps that only use HTTPS answer `false`. The command never guesses. For Expo, prefer `ios.config.usesNonExemptEncryption` in app.json, so every build carries the answer.

## 2. Run it

```bash
asc testflight --dry-run     # what it would do
asc testflight               # newest VALID build of the version being prepared
asc testflight --build 42    # a specific build number
```

In order, it sets export compliance, writes What to Test, fills the external-testing details, creates missing groups and adds the build to each, invites testers, and submits for beta app review when an external group has the build. A second run with nothing new sends nothing.

## Things that go wrong

| Symptom                              | Cause                                                    | Fix                                                           |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------- |
| `needs an export compliance answer`  | The build does not carry `ITSAppUsesNonExemptEncryption` | Ask the user, set `testflight.usesNonExemptEncryption`        |
| `no VALID build to test`             | Still processing, or not uploaded                        | Wait for processing; upload with `eas submit`                 |
| Beta review rejected                 | Missing description, broken login, crash                 | Read the email from Apple, fix, upload a new build, run again |
| Internal tester never gets an invite | Internal testers must be App Store Connect users         | Add them in Users and Access first, or use an external group  |
