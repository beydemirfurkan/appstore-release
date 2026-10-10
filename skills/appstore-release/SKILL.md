---
name: appstore-release
description: Ship an iOS app to App Store review end to end over the App Store Connect API — build attach, metadata, screenshots, pricing, age rating, content rights, review info, subscriptions and the review submission, driven by a readiness report that says what to do next. Use when the user says "publish/submit my app", "send it to App Review", "ship the iOS app", "release a new version", "fill out App Store Connect", "upload metadata", "why can't I submit", or "automate App Store Connect". Works for any app given an App Store Connect API key, an app id and a config file. Hands focused work to asc-screenshots, asc-age-rating, asc-subscriptions, asc-rejection and asc-credentials.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com. Needs an App Store Connect API key with the App Manager role. git is used once to fetch the CLI when the skill runs outside a checkout.
metadata:
  author: Furkan Beydemir
  version: "2.1.0"
---

# App Store Release

Drive an entire iOS App Store submission through the App Store Connect API. The user provides credentials and a config **once**; you do everything automatable and interrupt them only for what Apple genuinely keeps out of the API — today that is one thing, the App Privacy questionnaire.

## Operating principle

1. **Let `check` decide what to do.** It returns a verdict and an ordered list of next actions, each labelled as something the tool can fix or something only a human in App Store Connect can. Do not plan the sequence yourself — read it.
2. **Config-driven, not prompt-driven.** All app content lives in the config. Run commands; do not interview the user about things the config already answers.
3. **Ask about content, not about schema.** Paid or free, mature content, iPad support, languages — ask in the user's terms, then write the config yourself. `asc schema` prints the exact shape.
4. **Ask the user only when** a field is missing (say exactly which), a business decision is not in the config (price, release timing), or before the one irreversible action: the final submit.
5. **Everything is idempotent.** `release` is safe to re-run; a second run with nothing changed sends nothing.

## Running the CLI

Every command goes through the launcher inside this skill:

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from — for example `.claude/skills/appstore-release`, `~/.agents/skills/appstore-release`, or `${CLAUDE_PLUGIN_ROOT}/skills/appstore-release`. The launcher finds the CLI by itself (plugin install, repository checkout, or a one-time `git clone` pinned to this skill's version into `~/.cache/appstore-release`). If it says it is cloning, tell the user once. Set `APPSTORE_RELEASE_HOME` to use a specific checkout.

Below, `asc <command>` is shorthand for that line. Run it from the user's project directory — relative paths in the config resolve against the config file, so never `cd` first. Add `--json` for one machine-readable document on stdout; `asc <command> --help` lists that command's own flags.

## Setup

See [references/setup.md](references/setup.md). In short:

```bash
export ASC_KEY_ID=...            # 10 characters
export ASC_ISSUER_ID=...         # a UUID
export ASC_P8_PATH=/abs/AuthKey_XXXXXXXXXX.p8    # or ASC_P8 with the PEM inline
export ASC_APP_ID=1234567890     # digits from the App Store Connect URL, NOT the bundle id
```

Never put the key id, issuer id or `.p8` into a tool argument or a file you commit. They come from the environment only.

No config yet? `asc init` writes `appstore.config.json` with a `$schema`; fill it from what the user tells you ([references/config-template.json](references/config-template.json) shows every block). `asc validate` checks it offline, without credentials.

## Runbook

### 1. Orient

```bash
asc doctor      # credentials, openssl, config — touches no app data
asc check       # the verdict and the ordered plan
```

`verdict` is one of `ready`, `blocked`, `needs-human`, `in-review`, `rejected`, `live`. Exit codes: `0` ready · `4` blocked but fixable by this tool · `5` only a human in App Store Connect can finish.

### 2. Route by finding

Work through `nextActions` in order. When a finding belongs to a focused area, load that skill — it carries the detail this one leaves out:

| Finding ids / situation                                        | Skill or reference                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `screenshots.*`, "make screenshots", iPhone Duo, iPad sizes    | **asc-screenshots**                                                      |
| `rating.*`, "what age rating", social media / loot box answers | **asc-age-rating**                                                       |
| `subscription.*`, paywall, in-app subscription pricing         | **asc-subscriptions**                                                    |
| verdict `rejected`, `submission.rejected`, "Apple rejected it" | **asc-rejection**                                                        |
| `version.build.*` with an EAS signing error, expired profile   | **asc-credentials**                                                      |
| `metadata.*`, `config.*.emoji`, `config.*.too-long`, locales   | [references/metadata.md](references/metadata.md)                         |
| `account.credentials.*`, `config.missing`                      | [references/setup.md](references/setup.md)                               |
| any 409 you do not recognise                                   | [references/gotchas.md](references/gotchas.md) — read it before guessing |

If a focused skill is not installed, the reference files here and `asc <command> --help` are enough to proceed.

### 3. Open a version, if none is editable

`check` reports `version.none` when every version is already live:

```bash
asc new-version          # infers the next number
asc new-version 1.2.0    # or name it
```

### 4. Build the binary (Expo/EAS)

Only when `check` reports no build:

```bash
eas build -p ios --profile production --non-interactive --no-wait
eas submit -p ios --profile production --id <buildId>
asc attach-build                   # newest VALID build; or --build <number>
```

Signing failures (_"Provisioning Profile has expired"_, _"No certificate exists with serial…"_) belong to **asc-credentials**. Builds made with the iOS 27 SDK must ship a launch screen (`UILaunchScreen` or a launch storyboard) and adopt the scene lifecycle, or Apple rejects them; from April 2027 every upload must be built with Xcode 27.

### 5. Fill the listing

```bash
asc release --dry-run    # show the user exactly what would change
asc release              # apply it, then a fresh check
```

`release` runs attach-build, metadata, pricing, content-rights, age-rating, category, review-info, release-options, screenshots and subscription — each one idempotent. Run any of them alone by name.

### 6. Hand off the one UI-only step

**App Privacy → Data Collection.** Apple has no API for it. Ask the user to declare the data types matching the app's privacy manifest and press **Publish** (App Store Connect → the app → App Privacy). Then record that they did, so the readiness report can reach `ready`:

```json
"review": { "privacyPublished": true }
```

The API cannot verify this flag — only set it when the user confirms. If Publish is greyed out, see "NSUserTracking conflict" in [references/gotchas.md](references/gotchas.md#app-privacy-ui-only).

### 7. Submit

```bash
asc check
asc submit --submit
```

**Ask the user before running it.** `submit` computes the readiness report first and refuses unless the verdict is `ready`. A configured subscription is submitted together with the version — including a first subscription. If the user insists on submitting with blockers, `--force` exists; tell them Apple will reject it. Afterwards `asc status` should show the version as `WAITING_FOR_REVIEW`.

On rejection, switch to **asc-rejection**.

## MCP

The same core is an MCP server (`asc mcp`, 11 tools). Start with `asc_readiness_report`; every mutating tool needs `confirm: true`, and `asc_submit_for_review` refuses unless the report is `ready`.

## References

- [references/setup.md](references/setup.md) — API key, app record, secrets hygiene.
- [references/metadata.md](references/metadata.md) — fields, limits, locales, what Apple rejects.
- [references/gotchas.md](references/gotchas.md) — every pitfall hit in practice, with exact error text.
- [references/config-template.json](references/config-template.json) — a complete config, validated against the published schema.
- [references/screenshots.md](references/screenshots.md) — screenshot essentials (full guide in **asc-screenshots**).
