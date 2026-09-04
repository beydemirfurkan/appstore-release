# Command contract

Every file in `src/ops/` is a self-contained unit with a single responsibility and a
uniform shape, so the orchestrator (or an agent) can run them interchangeably.

```js
export const meta = {
  id: "metadata", // stable identifier
  title: "Store metadata", // human-readable title
  phase: "listing", // "build" | "listing" | "submit"
  needs: ["metadata"], // config concerns to validate before running (see src/core/config.mjs)
};

/**
 * @param {import("../core/context.mjs").Context} ctx  injected deps: { client, discovery, uploader, config, env, log }
 * @returns {Promise<{ status: import("../core/log.mjs").Status[keyof ...], message?: string, details?: object }>}
 */
export async function run(ctx) {
  /* ... */
}
```

Rules:

- **Idempotent.** Read current state; only mutate what's wrong. Re-running is a no-op → `Status.OK`.
- **Injected deps only.** Never read `process.env` or construct a client/discovery — use `ctx`.
- **Config-driven.** All app-specific content comes from `ctx.config`. No prompts, no hardcoded ids.
- **Honest status.** Return `MANUAL` for anything Apple only exposes in the web UI; the orchestrator surfaces these to the user.
- **Fail soft in the orchestrator.** Throwing is fine; the orchestrator catches and records `ERROR` so one failure doesn't abort the rest.
