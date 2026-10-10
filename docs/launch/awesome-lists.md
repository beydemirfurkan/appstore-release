# Awesome lists

Each list has its own rules; the entries below follow them as of October 2026. Check the list's CONTRIBUTING file again before opening a PR.

## punkpeye/awesome-mcp-servers

Public repository, installable: in scope. Add under **💻 Developer Tools**, near the other `b…` entries (the section is roughly alphabetical; the App Store Connect servers already there are `mikusnuz/app-publish-mcp`, `pofky/asc-mcp`, `zelentsov-dev/asc-mcp`). An agent opening the PR adds `🤖🤖🤖` to the end of the title, as the list asks.

```markdown
- [beydemirfurkan/appstore-release](https://github.com/beydemirfurkan/appstore-release) 📇 🏠 🍎 🪟 🐧 - Ships an iOS app to App Store review: a readiness report that says what blocks submission and who can fix it, an idempotent listing pipeline (metadata in every locale, screenshots incl. iPhone Duo, price, age rating, subscriptions), an offline preflight of the app itself, and a guarded submit. 13 outcome-shaped tools, no dependencies.
```

PR title: `Add beydemirfurkan/appstore-release`

## ComposioHQ/awesome-claude-skills

Asks for a real use case, documentation, tests, and confirmation before destructive operations — all met. Add as the first entry under **Development & Code Tools** (alphabetical, before `artifacts-builder`):

```markdown
- [appstore-release](https://github.com/beydemirfurkan/appstore-release) - Takes an iOS app to App Store review over the App Store Connect API: checks the app for what App Review rejects, fixes the listing (metadata, screenshots, price, age rating, subscriptions), and submits only when nothing blocks it. A router skill plus eight focused ones. _By [@beydemirfurkan](https://github.com/beydemirfurkan)_
```

PR title: `Add appstore-release skills`

PR body:

> Nine agent skills (a router plus focused ones for preflight, screenshots, age rating, subscriptions, TestFlight, rejections, signing and customer reviews) that take an iOS app to App Store review through the App Store Connect API. Checked read-only against a live App Store app; the whole flow also runs locally against a fake App Store Connect (`source scripts/demo/setup.sh`, no Apple account). Every write asks first, and submit refuses unless the readiness report says ready. MIT, no dependencies.

## travisvn/awesome-claude-skills

Requires social proof (stars, installs, mentions). Submit once the repository has some.

## VoltAgent/awesome-agent-skills

Declines skills without community adoption. Submit once skills.sh shows installs from others.

PR title: `Add skill: beydemirfurkan/appstore-release`

```markdown
- **[beydemirfurkan/appstore-release](https://github.com/beydemirfurkan/appstore-release)** - Ship iOS apps through App Store review via the API
```
