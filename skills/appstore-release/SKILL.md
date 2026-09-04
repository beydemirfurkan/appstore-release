---
name: appstore-release
description: Ship an iOS app to App Store review end-to-end via the App Store Connect API — build attach, metadata, screenshots, pricing, age rating, content rights, review info, subscriptions, and the review submission. Use when the user says "publish/submit my app", "send it to App Review", "ship the iOS app", "fill out App Store Connect", "upload metadata/screenshots", "my app got rejected", or "automate App Store Connect". Works for any app given an App Store Connect API key, an app id, and a config file.
---

# App Store Release

Drive an entire iOS App Store submission from the App Store Connect API. The user provides credentials and a config **once**; you do everything automatable and interrupt them only for the two things Apple genuinely does not expose.

## Operating principle

1. **Let `check` decide what to do.** It returns a verdict and an ordered list of next actions, each labelled as something the tool can fix or something only a human in App Store Connect can. Do not plan the sequence yourself — read it.
2. **Config-driven, not prompt-driven.** All app content lives in the config. Run commands; do not interview the user about things the config already answers.
3. **Ask the user only when**: the config is missing a field (say exactly which), a business decision is not in the config (subscription price, release timing), or before the single irreversible action (final submit).
4. **Everything is idempotent.** `release` is safe to re-run; a second run with nothing changed sends nothing.

## Setup — see references/setup.md

The user needs an App Store Connect API key with the **App Manager** role, and the numeric app id from the App Store Connect URL.

```bash
export ASC_KEY_ID=...            # 10 characters
export ASC_ISSUER_ID=...         # a UUID
export ASC_P8_PATH=/abs/AuthKey_XXXXXXXXXX.p8    # or ASC_P8 with the PEM inline
export ASC_APP_ID=1234567890     # digits from the ASC URL, NOT the bundle id
```

Run everything with `npx appstore-release <command>` from the user's project directory. Relative paths in the config resolve against the config file, so never `cd` anywhere first.

If there is no config yet: `npx appstore-release init` writes one with a `$schema`, then fill it in from what the user tells you. `npx appstore-release validate` checks it without needing credentials or a network.

For an app listed in several languages, add a `locales` block keyed by locale code. `metadata` is the default for all of them and each entry overrides only what differs — so ask the user for the translations, not for every field again. All configured locales are written and checked; an incomplete one is reported by name.

## Runbook

### 1. Orient

```bash
npx appstore-release doctor      # credentials, openssl, config — touches no app data
npx appstore-release check       # the verdict and the ordered plan
```

`check --json` gives the same thing as structured data: `verdict` is one of `ready`, `blocked`, `needs-human`, `in-review`, `rejected`, `live`, and `nextActions` is the plan.

### 2. Build the binary (Expo/EAS)

Only needed when `check` reports no build. If `eas build` fails on stale credentials (_"Provisioning Profile has expired / No certificate exists with serial…"_):

```bash
npx appstore-release credentials    # reuses an existing certificate when it can
```

then set `"credentialsSource": "local"` on the eas.json production profile. **Never pass `--allow-new-cert` without telling the user** — Apple caps the account at three distribution certificates.

```bash
eas build -p ios --profile production --non-interactive --no-wait
eas submit -p ios --profile production --id <buildId>
```

### 3. Fill the listing

```bash
npx appstore-release release --dry-run    # show the user exactly what would change
npx appstore-release release              # apply it
```

Screenshots must already exist at `config.screenshots.dir` — see references/screenshots.md for producing exact-size PNGs. If the app supports iPad, it needs an iPad set too: use `config.screenshots.sets` with one entry per device size. A locale subdirectory (`./shots/tr/`) overrides the base directory for that locale.

### 4. Hand off the two UI-only steps

`check` lists these when they apply, with the exact clicks. Apple has no API for either; do not pretend otherwise and do not attempt a workaround.

1. **App Privacy → Data Collection.** Declare the data types matching the app's privacy manifest, then **Publish**. If the binary ships `NSUserTrackingUsageDescription` but you declare no tracking, Publish is blocked — the app must drop the key and be rebuilt (references/gotchas.md).
2. **A first subscription.** Version page → _In-App Purchases and Subscriptions → Select → \<product\>_ → Save → _Add for Review → Submit_.

### 5. Submit

```bash
npx appstore-release check
npx appstore-release submit --submit
```

`submit` computes the readiness report first and refuses unless the verdict is `ready`. If the user insists on submitting anyway, `--force` exists — tell them Apple will reject it.

Verify with `status`: the version and any subscription should both be `WAITING_FOR_REVIEW`.

### Rejections

On rejection the version becomes editable again. The rejection _text_ lives in Resolution Center, which Apple does not expose through the API — the user has to read it. Then fix (metadata via `release`, or a rebuild for binary issues) and resubmit.

## When something returns a 409

Read references/gotchas.md before guessing. It documents the exact error strings and their causes: emoji in the description, `whatsNew` on a first version, the age-rating attribute set, `ageRatingOverride` conflicting with `ageRatingOverrideV2`, the missing price tier, the screenshot commit step.

## Extending

Operations live in `src/ops/`, one file each, with a uniform `{ meta, run(ctx, args) }` contract — see `src/ops/_contract.md`. Add a file, register it in `src/ops/registry.mjs`, and both the CLI and the MCP server pick it up.

## References

- `references/setup.md` — key creation, app record, secrets hygiene.
- `references/gotchas.md` — every pitfall hit in practice. Read before the first run.
- `references/screenshots.md` — producing exact-size PNGs.
- `references/config-template.json` — the config, validated against a published JSON Schema.
