<div align="center">

# appstore-release

**Ship an iOS app to App Store review by asking your agent.**

[![skills.sh](https://skills.sh/b/beydemirfurkan/appstore-release)](https://skills.sh/beydemirfurkan/appstore-release) [![CI](https://github.com/beydemirfurkan/appstore-release/actions/workflows/ci.yml/badge.svg)](https://github.com/beydemirfurkan/appstore-release/actions/workflows/ci.yml) [![MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE) [![iOS 27](https://img.shields.io/badge/iOS-27-black)](docs/reference.md#updated-for-ios-27)

<img src="docs/media/hero.gif" alt="appstore-release: check finds twelve blockers, release fixes them, submit sends the app and its new subscription to App Review" width="860">

<sub>Real output, recorded against the demo below.</sub>

</div>

<br>

```bash
npx skills add beydemirfurkan/appstore-release
```

Then tell your agent: **"Publish my app for review."**

The agent reads your app from App Store Connect and names everything that stands between it and review. It then fixes whatever Apple's API allows and submits only once nothing is in the way.

## Try it without an Apple account

```bash
git clone https://github.com/beydemirfurkan/appstore-release && cd appstore-release
source scripts/demo/setup.sh

appstore-release check
appstore-release release
appstore-release submit --submit
```

The demo runs against a local stand-in for App Store Connect, so nothing leaves your machine.

## How it works

**`check`** reads the whole app and returns a verdict with an ordered plan. Each finding says whether the tool can fix it or only you can.

**`release`** writes the listing: build, metadata in every locale, price, age rating, screenshots, subscriptions and in-app purchases. It is idempotent; a second run sends nothing.

**`submit`** sends the version with any new plans and purchases, and refuses unless `check` says ready. `check --wait` then follows the review to its outcome.

Apple keeps two things in its web UI: the App Privacy label and an app's first subscription or in-app purchase. For those, `check` tells you exactly where to click.

Using Expo? Your `store.config.json`, `eas.json` and `app.json` are read as they are.

## Skills

`appstore-release` reads the plan and hands each finding to the skill that knows that area:

- **asc-screenshots**: exact sizes, iPhone Duo, iPad
- **asc-age-rating**: the 2026 questionnaire
- **asc-subscriptions**: plans, free trials, lifetime purchases
- **asc-rejection**: read the reviewer's message, fix, resubmit
- **asc-credentials**: EAS certificates and provisioning profiles
- **asc-testflight**: groups, testers, What to Test, beta review
- **asc-reviews**: read customer reviews, draft replies, publish each after your OK

## Also runs as

- **Claude Code:** `/plugin marketplace add beydemirfurkan/appstore-release`
- **Claude Desktop:** open [`appstore-release.mcpb`](https://github.com/beydemirfurkan/appstore-release/releases/latest/download/appstore-release.mcpb)
- **Any MCP host:** `npx -y -p github:beydemirfurkan/appstore-release appstore-release-mcp` ([config](docs/reference.md#mcp-server))
- **CLI:** `npx github:beydemirfurkan/appstore-release check`

Connecting a real app takes an App Store Connect API key and a config file; the [reference](docs/reference.md#quick-start-with-a-real-app) walks through both.

<br>

<div align="center">
<sub>
Up to date with iOS 27 and App Store Connect API 4.5 · Zero dependencies · Node 20.11+<br>
<a href="docs/reference.md">Reference</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="LICENSE">MIT</a> · Not affiliated with Apple
</sub>
</div>
