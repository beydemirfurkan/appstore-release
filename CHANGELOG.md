# Changelog

## Unreleased

### Added

- **`new-version`.** There was no `POST /v1/appStoreVersions` anywhere, so once every version was live the tool had no way forward: the snapshot correctly refuses to target a live version, and then nothing could open the next one. It infers the next number from the newest existing version, or takes one explicitly, and is a no-op when a version is already editable. The readiness report now points at it.
- **Release timing (`release-options`).** `review.releaseType` sat in the config template from the first release and was read by nothing — a documented setting that silently did nothing. It works now, from a top-level `release` block (`type`, `earliestDate`, `phased`), because release timing is not review information. `review.releaseType` still works and warns. Phased release is supported; SCHEDULED without a date is refused rather than sent.
- **Arbitrary age ratings.** The declaration was a hardcoded 21-key 4+ constant, so an app with any mature content could not use this tool at all. `config.ageRating` now names only what differs; the complete attribute set is still always sent, because Apple returns 409 for a partial one. `ageRating4Plus: false` keeps its old meaning. It also reads before writing, so an unchanged declaration reports OK instead of a change.
- **Paid price tiers.** `pricing` only understood `price: "free"`, so a paid app could not be released. `price` now also takes `{ amount, baseTerritory }`, resolved to Apple's nearest price point — the same logic subscriptions already used, now shared rather than duplicated. It says so when the nearest point differs from the amount asked for, rather than silently charging something else.
- **Multiple screenshot device sizes.** `screenshots.displayType` handled exactly one, so an app supporting iPad could not be submitted at all — Apple requires an iPad set for a tablet-capable build and there was no way to express one. `screenshots.sets` takes an entry per device size, and a subdirectory named after a locale (`./shots/tr/`) overrides the base directory for that locale, so a multi-locale multi-device config does not become a matrix written out by hand. Each set is diffed and reported independently.
- **Multi-locale listings.** `config.locale` was a single string, so an app listed in more than one language got exactly one localization filled and the rest left empty — which Apple rejects, with nothing here saying so. A `locales` block, keyed by locale code, now describes as many as you like; `metadata` is the default for all of them and each entry overrides only what differs. Every configured locale is written, validated and reported on, and a locale present in App Store Connect but absent from the config is surfaced rather than left looking accounted for. The flat single-locale form is unchanged.

## 2.0.0

`appstore-release` becomes an installable product rather than a directory you had to `cd` into. It now ships as an npm package with a CLI, an MCP server and a library API, all over one core.

### Breaking

| Change                                                                             | Who it affects                 | What to do                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| `cd skills/appstore-release/scripts && node cli.mjs X` → `npx appstore-release X`  | plugin and skill users         | use the binary; there is no shim                                |
| Relative config paths resolve against the config file, not the process directory   | anyone who ran from `scripts/` | this _is_ the fix — paths now mean what the config author meant |
| Default config name `config.json` → `appstore.config.json`                         | new users only                 | the old name is still discovered                                |
| Node 18 → 20.11                                                                    | anyone on 18                   | 18 is end-of-life                                               |
| Exit codes `0/1` → an eight-code table                                             | anyone scripting `== 1`        | see below, or use `--exit-zero`                                 |
| `createContext(requireAppId, requireConfig)` → `createContext(options)`, now async | no published consumers         | —                                                               |

`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_P8_PATH`, `ASC_APP_ID` and `APPSTORE_CONFIG` all still work. They are one source of credentials now rather than the only one.

Exit codes: `0` ok · `1` internal error · `2` usage · `3` config/credentials · `4` blocked but fixable · `5` only a human in App Store Connect can finish · `6` App Store Connect refused after retries · `7` confirmation required.

### Fixed

- **Screenshot and subscription image uploads were silently broken in 1.0.0.** The commit step PATCHed a path without the `/v1` prefix, so every asset stayed reserved and invisible — the usual cause of a subscription stuck in `MISSING_METADATA` with nothing in the UI to explain it. (Also released as 1.0.1.)
- **`credentials` issued a new distribution certificate on every run.** Apple caps an account at three and there was no revocation path, so three runs left you unable to build. It now reuses a certificate whose private key you already hold, and refuses the last slot without `--allow-new-cert`. Adds `--list` and `--revoke`.
- **`screenshots` deleted every remote screenshot before uploading.** A failure partway through left the listing with fewer screenshots than it started with. It now diffs against the checksum App Store Connect stores and uploads only what changed. Screenshots stuck mid-upload are detected and replaced.
- **`subscription` deleted and recreated an identical price and review screenshot on every run.**
- **`metadata` PATCHed every field unconditionally** and always reported a change. Its first-version test was also wrong, so `whatsNew` was never sent for an actual update.
- **`--build` was documented but never parsed** — the flag had no effect at all.
- **`credentials` was excluded from config loading** but required `config.bundleId`, so it always failed.
- **A missing editable version silently targeted the live one.** It now reports that no editable version exists.
- **`--json` interleaved human text with the JSON** on the same stream, so it could not be piped.
- Config paths, `credentials.json` included, resolved against the process directory — which, following the old instructions, meant writing a secret into the installed plugin's own tree.
- User-controlled config values were interpolated into `openssl` shell command lines.
- Emoji in the description was reported as a warning; App Store Connect rejects it outright.

### Added

- **MCP server** — 10 outcome-shaped tools and 6 resources over stdio, for any MCP-speaking agent. `asc_readiness_report` is the one to start from. Every mutating tool requires `confirm: true`; `asc_submit_for_review` refuses unless the app is actually ready; credentials never enter tool arguments.
- **Readiness report** — `check` returns a verdict, findings and an ordered plan as structured data, rendered as text, JSON or markdown. Each finding says who can fix it and how, and distinguishes "Apple has no API for this" from "we have not automated it yet".
- **`--dry-run`**, enforced at the HTTP client so no operation can forget it.
- **Published JSON Schema** for the config, with `init`, `schema` and `validate` commands that need no credentials.
- **`doctor`** — verifies credentials, key role, `openssl` and config without touching app data.
- **Library API** — `createContext`, `runOperation`, `runPipeline`, `getReadinessReport`, `listOperations`.
- `ASC_P8` carries the private key inline, for CI and MCP hosts that cannot write a `.p8` to disk.
- Retry with jitter, `Retry-After`, timeouts and real pagination. POST is never retried after a connection drop.
- Local PNG validation with no `sips`, so screenshot checks work on any OS.
- 72 tests, type checking, and CI across Node 20/22/24 on Linux and macOS.

## 1.0.1

- Fixed the asset commit path (`/v1` prefix), which broke every screenshot and subscription image upload.

## 1.0.0

- Initial release as a Claude Code plugin and agent skill.
