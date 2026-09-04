# Operation contract

Every file in `src/ops/` is a self-contained unit with a single responsibility and
a uniform shape, so the orchestrator — a CLI, an MCP server, a library caller —
can run them interchangeably.

```js
/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "screenshots", // stable identifier; must match the registry key
  title: "Screenshots", // human-readable title
  phase: "listing", // "build" | "listing" | "submit"
  needs: ["screenshots"], // config concerns, ENFORCED before run() is called
  mutates: true, // drives --dry-run and the MCP tool annotations
  destructive: true, // can delete data that already exists in ASC
  irreversible: false, // true only for `submit`
  args: {
    // parsed generically by the CLI, exposed by MCP
    prune: { type: "boolean", default: true, description: "delete remote shots with no local match" },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {Record<string, any>} args
 * @returns {Promise<{ status, message?, details?, findings?, changes? }>}
 */
export async function run(ctx, args) {}
```

Rules:

- **Idempotent.** Read current state; only mutate what is wrong. Re-running is a
  no-op → `Status.OK`. Reporting `CHANGED` unconditionally is a bug, not a detail.
- **Injected deps only.** Never read `process.env`, never construct a client, and
  never call `process.cwd()` — use `ctx.resolvePath` so relative paths resolve
  against the config's directory.
- **`needs` is load-bearing.** `runOperation` validates it before calling `run`,
  so an operation may assume the keys it declared are present. Do not re-check.
- **Honest status.** Return `MANUAL` for anything Apple only exposes in the web
  UI. Under `ctx.dryRun` the client refuses every write for you; only an operation
  with side effects outside HTTP (see `credentials`) needs its own dry-run branch.
- **Fail soft.** Throwing is fine — `runOperation` catches it, records `ERROR`
  with the App Store Connect error attached, and lets the rest of the pipeline run.
