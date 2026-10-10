# AGENTS.md

Instructions for coding agents (Codex, Cursor, Copilot, Gemini, Claude Code and others) working **with** or **on** this repository.

## What this is

`appstore-release` ships an iOS app to App Store review over the App Store Connect API. One zero-dependency Node core serves four surfaces: a CLI, an MCP server, a library, and a set of agent skills. Its job is narrow on purpose: get an app through review, idempotently, and say exactly what is left when it cannot.

## Using it to ship an app

Load the skill that matches the task. Each is self-contained under `skills/<name>/` and runs the CLI through its own `scripts/asc.mjs` launcher.

| Skill                                                    | Use it for                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`appstore-release`](skills/appstore-release/SKILL.md)   | The whole submission: readiness check → fix → listing → submit. Start here.    |
| [`asc-screenshots`](skills/asc-screenshots/SKILL.md)     | Sizes (6.9", iPhone Duo, 13" iPad), producing images, App Asset Library upload |
| [`asc-age-rating`](skills/asc-age-rating/SKILL.md)       | The age-rating questionnaire, 13+/16+/18+ tiers, social media questions        |
| [`asc-subscriptions`](skills/asc-subscriptions/SKILL.md) | Plans, free trials, lifetime purchases: metadata, price, review submission     |
| [`asc-testflight`](skills/asc-testflight/SKILL.md)       | TestFlight: groups, testers, What to Test, beta review                         |
| [`asc-reviews`](skills/asc-reviews/SKILL.md)             | Customer reviews: read, draft replies, publish each one after approval         |
| [`asc-rejection`](skills/asc-rejection/SKILL.md)         | Rejection → guideline → fix → reply → resubmit                                 |
| [`asc-credentials`](skills/asc-credentials/SKILL.md)     | EAS signing: distribution certificate and App Store profile                    |

Install them into your agent:

```bash
npx skills add beydemirfurkan/appstore-release            # all eight
npx skills add beydemirfurkan/appstore-release -s asc-screenshots -a codex
```

Or run the CLI straight from a checkout — there is no install step:

```bash
node src/cli.mjs check          # verdict + ordered next actions
node src/cli.mjs release --dry-run
node src/cli.mjs mcp            # MCP server on stdio
```

Credentials come from `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_P8_PATH` (or `ASC_P8`) and `ASC_APP_ID`.

### Rules

1. **Never put credentials in a tool argument, a prompt, a log or a commit.** Key id, issuer id and `.p8` come from the environment only; no MCP tool accepts them, and a test enforces that.
2. **Ask the user before `submit --submit`** (or `asc_submit_for_review`) — it is irreversible. It refuses unless the readiness verdict is `ready`; only use `--force` when the user insists, and tell them Apple will reject it.
3. **Ask before `credentials --allow-new-cert`** — Apple caps an account at three distribution certificates.
4. **Let `check` plan.** Work through its `nextActions` in order instead of inventing a sequence.
5. **Do not pretend Apple has an API it does not.** App Privacy is UI-only; set `review.privacyPublished: true` only after the user confirms they published it. An app's first subscription is submitted from the App Store Connect website with the binary; never try to work around that.
6. **Dry-run first** when showing the user what will change: every mutating command accepts `--dry-run`, enforced at the HTTP client.

## Working on this repository

- Plain ESM JavaScript with JSDoc, type-checked by `tsc --checkJs`. **No build step and no runtime dependencies** — the files that ship are the files you edit; `scripts/check-distribution.mjs` fails the build on any non-builtin import under `src/`.
- `npm ci && npm run verify` — typecheck, Prettier, schema, manifests, distribution gate, skill gate, tests.
- A new capability is a file in `src/ops/` with the `{ meta, run(ctx, args) }` contract ([`src/ops/_contract.md`](src/ops/_contract.md)), registered in `src/ops/registry.mjs`. The CLI and MCP server pick it up.
- The MCP tool list is deliberately small (13 tools, count asserted in `test/mcp.test.mjs`). Prefer extending an outcome tool over adding an endpoint-shaped one.
- **Skills:** edit `skills/<name>/SKILL.md` and its `references/`. Never edit `skills/*/scripts/asc.mjs` — it is generated from `scripts/skill-launcher.mjs` by `npm run manifests:sync`, which also stamps every skill's `metadata.version` from `package.json`. `npm run check:skills` holds each skill to the Agent Skills spec: name equals directory, description ≤ 1024 characters with "Use when…" triggers, SKILL.md under 500 lines, and no link that leaves the skill directory (an installed skill is that directory alone).
- Every operation must stay idempotent: a second run with nothing changed sends nothing. Add a test against `test/helpers/mock-asc.mjs`.
