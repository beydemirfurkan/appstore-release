# Contributing

The most valuable contributions are **new gotchas** and **new checks**: an App Store Connect failure you hit, what it actually meant, and how to detect it before someone else spends a round trip on it.

## Getting set up

```bash
npm ci
npm run verify     # typecheck, format, schema, manifests, tests
```

No build step. The files that ship are the files you edit.

## Adding an operation

Drop a file in `src/ops/` exporting `meta` and `run(ctx, args)` — the contract is in [`src/ops/_contract.md`](src/ops/_contract.md) — and register it in `src/ops/registry.mjs`. The CLI, the MCP server and the help screen all pick it up from there.

Two rules that are enforced by tests rather than by review:

- **Idempotent.** Read current state, write only what differs, return `OK` when nothing did. There is a test that runs every operation twice.
- **No writes under `--dry-run`.** The HTTP client handles this for you; if your operation has side effects outside HTTP, guard them yourself (see `credentials`).

## Adding a check

`src/report/checks/` — a pure function over a snapshot returning findings. Add a fixture case in `test/report.test.mjs`.

Be careful with one field: `uiOnly: true` means Apple exposes no API and never will. If we simply have not automated something, that is `fixOwner: "ui"` with `uiOnly: false`. Marking our own gaps as Apple's limitations is the one thing this tool cannot afford to get wrong, and there is a test that stops you.

## Adding an MCP tool

Think hard first. The tool count is a product decision, not an accident: a long tool list is a tax on every conversation the server is attached to, and the value here is that the tools are outcome-shaped rather than endpoint-shaped. A new tool should represent an outcome someone wants, not an API call someone could make.
