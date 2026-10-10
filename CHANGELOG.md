# Changelog

## 3.0.0

Updated for iOS 27 and App Store Connect API 4.4.1–4.5.1, split into agent skills, and — most importantly — able to finish a submission end to end, which 2.1.0 could not.

### Breaking

- **App Privacy now needs your word for it.** The readiness report used to block on App Privacy unconditionally, which meant the verdict could never be `ready` and `submit --submit` always refused. Once the privacy label is published in App Store Connect, set `"review": { "privacyPublished": true }`. Without it, `check` still blocks with the exact clicks.
- **A first subscription is submitted by API.** `submit` adds the subscription version — and its group's, for a new group — to the same review submission as the app version (API 4.4.1). The `subscription.first.ui-only` finding is gone; `subscription.ready-to-submit` (info) replaces it.
- **Age-rating frequencies are `NONE` / `INFREQUENT` / `FREQUENT`.** The pre-2025 `INFREQUENT_OR_MILD` / `FREQUENT_OR_INTENSE` are still accepted in a config and mapped.
- **`credentials` asks before issuing any certificate**, not only the last of Apple's three. Pass `--allow-new-cert`.
- **Screenshots go through the App Asset Library by default** (`screenshots.api: "auto"`). Apps without a library fall back to the deprecated screenshot sets automatically; `"legacy"` forces them.

### Fixed — the product could not complete a submission

- Operation flags were rejected before the operation was known: `submit --submit`, `--allow-new-cert`, `--build`, `--no-prune` all exited 2. Flags are kebab-case as documented, positional arguments reach the operation (`new-version 1.2.0`), and `<command> --help` lists a command's own flags.
- `asc_submit_for_review` dropped `force` and reported `submitted: true` whatever happened. `asc_apply_release` pruned screenshots by default, and its `only` argument could run `credentials` or `submit` past their own gates; it now accepts pipeline steps only.
- `submit` no longer reuses a submission that is already with Apple, treats one in flight as a no-op instead of "not ready", and no longer swallows 409s when adding items.
- One list of version states. A version removed from sale no longer counts as editable, discovery never falls back to a live version, and the editable App Info is preferred during an update.
- `review-info`, `category`, `release-options`, `pricing` and no-prune `screenshots` no longer write on every run. `attach-build` only considers VALID, unexpired iOS builds of the version's marketing version. Subscription pricing reads every page of price points and touches only its own territory. `screenshots.sets` no longer requires a top-level `dir`.

### Added — iOS 27 / API 4.5.1

- **App Asset Library** screenshots: placement groups and exact specs from `appAssetLibraryRefData` (never hard-coded), a content hash in `referenceName` for idempotency, one upload reused across locales, ordering requests, placement-first deletes.
- **iPhone Duo**: a set with `placementGroup`; `screenshots --list-groups`; a reminder before Apple's April 2027 requirement.
- Every accepted 6.9" and 13" size and landscape; screenshots with alpha are refused before upload.
- Age rating: `socialMedia`, `socialMediaAgeRestricted`, and `ageRating.override` → `ageRatingOverrideV2`.
- `subscription.localizations` for other locales; existing localizations are updated, not only created.

### Added — agent skills

- A router skill (`appstore-release`) and five focused skills: `asc-screenshots`, `asc-age-rating`, `asc-subscriptions`, `asc-rejection`, `asc-credentials`. Installable with `npx skills add beydemirfurkan/appstore-release`, each with a launcher that finds the CLI even when only the skill folder was copied.
- `AGENTS.md`, `skills.sh.json`, every skill served as an MCP resource.
- `check-skills` and launcher-drift gates; CI runs them and the distribution gate on every PR.

### Added — try it, see it

- A stateful fake App Store Connect and an end-to-end test that drives the real CLI from blocked to `WAITING_FOR_REVIEW`, asserting a second `release` sends nothing.
- `source scripts/demo/setup.sh` runs the whole flow locally with no Apple account. The README's GIFs are recorded from it (`npm run media`).
- A shorter terminal report: each section names what is wrong, the plan names the command, nothing is printed twice.

### Changed — distribution

**Nothing to install.** The package is no longer published to any registry, and it no longer has runtime dependencies. `git clone && node src/cli.mjs` and `git clone && node src/mcp/server.mjs` are the whole setup.

That meant replacing `@modelcontextprotocol/sdk` and `zod` with about 250 lines: a newline-delimited JSON-RPC 2.0 transport and the six MCP methods this server actually implements. The replacement was checked against a captured wire trace of the SDK server rather than against the spec from memory; the only differences left are deliberate — `listChanged: false` because we never send those notifications, `additionalProperties: false` on tool inputs, and clearer validation messages.

Tool input schemas are now plain JSON Schema, which is what went on the wire anyway. The same validator that checks a user's config now checks a model's tool arguments.

This also fixes the Claude Code plugin properly. A plugin install is a git clone with no install step, so a server that needed `node_modules` could never have run there; `.mcp.json` now points straight at the file instead of shelling out to a package manager.

A `check:dist` gate fails the build if a runtime dependency reappears or anything under `src/` imports something that would need installing, and a CI job drives both the CLI and the MCP server from a bare checkout.

## 2.1.0

Everything here is additive: a 2.0.0 config still means exactly what it did.

### Added

- **`asc_open_next_version`, the eleventh MCP tool.** Deliberate, not drift: without it an agent that hit `version.none` had no way forward at all, since every other tool needs an editable version to act on.
- **The rejection report says what the API actually knows.** It now reads the open submission's items and distinguishes a metadata rejection from a binary one, while stating plainly that the reviewer's message lives in Resolution Center and is not exposed through the API. Also reports `UNRESOLVED_ISSUES`, which is a submission Apple would not accept at all rather than one it reviewed and rejected.
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
