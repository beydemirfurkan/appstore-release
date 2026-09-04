---
name: appstore-release
description: Ship an iOS app (built with EAS/Expo) to App Store review end-to-end via the App Store Connect API — credentials, build attach, metadata, screenshots, pricing, age rating, content rights, review info, subscriptions, and the review submission. Use when the user says "publish/submit my app", "send it to App Review", "ship the iOS app", "fill out App Store Connect", "upload metadata/screenshots", or "automate App Store Connect". Parametric: works for any app given an ASC API key + app id + a config file.
---

# App Store Release

Drive an entire iOS App Store submission from the **App Store Connect API**. Design goal: the user provides credentials + a `config.json` **once**, then the agent does everything that is automatable and only interrupts the user for the handful of things Apple genuinely does not expose via API. **Do not ask the user to re-confirm things that are already in the config or have sensible defaults.**

## Operating principle (read this first)

1. **Config-driven, not prompt-driven.** All app content lives in `config.json`. Run commands; don't interview the user.
2. **Only two things are UI-only** (Apple has no API): **App Privacy data-collection** and **first-time subscription attach + submit**. The tooling detects and surfaces these with exact clicks. Everything else is scripted.
3. **Ask the user only when**: config is missing a required field (tell them exactly which), a business decision isn't in config (subscription price, release timing), or before the single irreversible action (final submit). Otherwise proceed.
4. **Idempotent**: every command is safe to re-run. `appstore-release release` can be run repeatedly.

## Architecture (SOLID, so you can extend it)

```
scripts/
  cli.mjs                 single entrypoint / dispatcher (appstore-release <command>)
  lib/                    injected services, one responsibility each
    env.mjs               parse+validate env (creds, app id)
    jwt.mjs               ES256 token provider
    client.mjs            AscClient — auth + HTTP + uniform errors
    discovery.mjs         locate ASC resources by natural key (no hardcoded ids)
    assets.mjs            reserve→upload→commit binary uploader
    config.mjs            load + validate config, list what's missing
    log.mjs               structured results + machine-readable summary
    context.mjs           composition root (dependency injection)
  commands/               one file per task; uniform contract (see _contract.md)
```

Add a capability = add a `commands/x.mjs` (meta + `run(ctx)`) and register it in `cli.mjs`.

## Setup (one time) — see references/setup.md

1. ASC API key (**App Manager**): download `AuthKey_XXXX.p8`, note Key ID + Issuer ID.
2. App record exists in ASC (bundle id registered). `ASC_APP_ID` = numeric id from the app's ASC URL.
3. EAS project configured, `eas login` done.
4. Fill `config.json` from `references/config-template.json`. Validate anytime: any command prints exactly which fields are missing.

## Environment

```bash
export ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_P8_PATH=/abs/AuthKey_XXXX.p8   # gitignore the .p8
export ASC_APP_ID=1234567890
export APPSTORE_CONFIG=/abs/config.json
```

Run it with `npx appstore-release <command>` from the user's project directory — no
`cd` anywhere, and never from inside this skill's own directory.

## Runbook

### 1. Orient

```bash
appstore-release status          # full read-only overview
appstore-release check           # readiness + the UI-only steps still pending
```

### 2. Build the binary (EAS)

- If `eas build` fails with stale credentials (_"provisioning profile expired / no certificate with serial…"_):
  ```bash
  appstore-release credentials     # fresh dist cert + profile → credentials.json
  ```
  then set `"credentialsSource":"local"` on the eas.json production profile.
- Build + submit the binary (export `EXPO_ASC_API_KEY_PATH/KEY_ID/ISSUER_ID` + `EXPO_APPLE_TEAM_ID` + `EXPO_APPLE_TEAM_TYPE` for non-interactive):
  ```bash
  eas build -p ios --profile production --non-interactive --no-wait
  eas submit -p ios --profile production --id <buildId>
  ```
  Wait until the build is **VALID** (`appstore-release status`).

### 3. Fill the entire listing in one shot

```bash
appstore-release release         # attach build → metadata → pricing → content-rights →
                             # age-rating → category → review-info → screenshots →
                             # subscription → check
```

`release` runs the whole pipeline (idempotent) and ends with `check`, which prints the remaining **UI-only** steps. Screenshots must exist first (`config.screenshots.dir`) — see references/screenshots.md to generate them.

### 4. The two UI-only steps (hand off with exact clicks)

`check` lists these when they apply:

1. **App Privacy → Data Collection**: declare the data types matching the app's privacy manifest, then **Publish**. ⚠️ If the binary ships `NSUserTrackingUsageDescription` but you declare no tracking, Publish is blocked → remove the key, rebuild (references/gotchas.md).
2. **First-time subscription**: version page → _In-App Purchases and Subscriptions → Select → <product>_ → Save → _Add for Review → Submit_. (The API can't attach a first subscription.)

### 5. Submit

```bash
appstore-release check                 # confirm nothing's missing
appstore-release submit --submit       # app-only / updates (no first-time IAP)
```

For a first-time subscription, the user submits in the UI (step 4.2). Verify with `status`: version + subscription both `WAITING_FOR_REVIEW`.

### Rejections

On rejection the version becomes editable again (`REJECTED`/`METADATA_REJECTED`/`DEVELOPER_REJECTED`). Read the resolution-center message, fix (metadata via `release`, or rebuild for binary issues), resubmit.

## References

- `references/setup.md` — key creation, app record, EAS, secrets hygiene.
- `references/gotchas.md` — every real pitfall (read before the first run).
- `references/screenshots.md` — generating exact-size PNGs (HTML → headless Chrome).
- `references/config-template.json` — per-app config (validated by `lib/config.mjs`).
