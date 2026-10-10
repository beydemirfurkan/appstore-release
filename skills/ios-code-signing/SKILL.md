---
name: ios-code-signing
description: Fix iOS code-signing for EAS/Expo builds through the App Store Connect API — reuse or issue an Apple Distribution certificate, create an App Store provisioning profile, and write credentials.json for local EAS credentials, without spending Apple's three-certificate limit by accident. Use when eas build fails with "Provisioning Profile has expired", "No certificate exists with serial", "Distribution certificate … not found", "too many certificates", or when the user says "fix my iOS credentials", "regenerate the provisioning profile", or "EAS signing is broken".
license: MIT
compatibility: Node.js 20.11+, openssl on PATH, and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager or Admin). The config needs bundleId.
metadata:
  author: Furkan Beydemir
  version: "4.3.0"
  guidelines: "2026-06-08"
---

# iOS credentials for EAS

> **You say:** _"My EAS build fails on the provisioning profile."_ · _"Fix my iOS signing."_
>
> **It does:** Reuses or issues an Apple Distribution certificate and an App Store profile and writes them for EAS — without spending one of Apple's three certificate slots unless you say so.

When EAS's stored certificate or profile drifts from what Apple has, `eas build` fails non-interactively. This skill replaces EAS-managed signing with local credentials generated through the API.

## Running the CLI

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from. Below, `asc` means that line. Credentials come from the environment only.

## 1. Look before changing anything

```bash
asc credentials --dry-run
```

It reports the account's distribution certificates and what it would do for `config.bundleId` — reuse, issue, create a profile — without sending anything. Show this to the user.

## 2. Generate

```bash
asc credentials                          # reuse a certificate whose private key you already hold
asc credentials --reuse-cert <certId>    # name the certificate to reuse
asc credentials --allow-new-cert         # issue a new certificate — uses one of 3 slots
```

**Never pass `--allow-new-cert` without asking the user.** Apple caps an account at three distribution certificates, shared by every app and CI system on the team; a new one can break someone else's pipeline when a slot has to be revoked later. The command refuses to issue one without the flag.

Output goes to `config.credentials.outputDir` (default `./secrets`), files `0600` in a `0700` directory:

- `dist.key` — the certificate's private key (keep it: it is what lets a later run reuse the certificate),
- `dist.p12` — exported with `openssl -legacy`, which EAS needs; its password is in `credentials.json`,
- `profile.mobileprovision` — the App Store profile,
- `credentials.json` — EAS's local credentials format.

The command checks `git check-ignore` and reports any of these that git would commit.

## 3. Point EAS at them

In `eas.json`, on the production build profile:

```json
"build": {
  "production": { "credentialsSource": "local" }
}
```

Then:

```bash
eas build -p ios --profile production --non-interactive --no-wait
```

## Revoking

```bash
asc credentials --revoke <certId>
```

Ask first, and say which builds or teammates might be using it. A revoked certificate invalidates every profile made from it; apps already on the App Store are not affected.

## Gotchas

- A native `ios/` directory makes EAS ignore app.json's `bundleIdentifier` and `infoPlist` — the build signs what Xcode's project says.
- The bundle id must be registered (Certificates, Identifiers & Profiles → Identifiers) and match `config.bundleId` exactly.
- Builds made with the iOS 27 SDK need a launch screen and the scene lifecycle; from April 2027 Xcode 27 is mandatory for uploads. A signing fix will not help a build that fails review for those.
- `ITSAppUsesNonExemptEncryption = false` in Info.plist answers export compliance once instead of on every build.

_Checked against the App Store Review Guidelines of June 8, 2026._
