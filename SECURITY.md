# Security

## Reporting

Please open a [security advisory](https://github.com/beydemirfurkan/appstore-release/security/advisories/new) rather than a public issue.

## What this tool handles

An App Store Connect API private key (`.p8`), and — if you use the `credentials` command — a generated distribution private key and the password to its `.p12`.

Design rules it follows:

- **The `.p8` is read only to sign short-lived ES256 JWTs locally.** Nothing is sent anywhere except `api.appstoreconnect.apple.com`.
- **The private key is non-enumerable on the credentials object**, so it cannot appear in `--json` output, an MCP tool result, a log line or an error.
- **No MCP tool accepts a key id, issuer id or private key as an argument.** Tool arguments are model-visible and reach transcripts, host logs and telemetry; a leaked `.p8` cannot be rotated without breaking every other integration using it. Credentials come from the server's environment only. There is a test asserting this.
- **Pre-signed upload URLs never receive the bearer token** — they carry their own auth and belong to a third party.
- **Generated secrets are written `0600` inside a `0700` directory**, and `git check-ignore` is consulted afterwards so an unignored secret is reported rather than quietly waiting to be committed.
- **Paths from a config or a tool argument are confined to the project root**, resolved through `realpath` so a symlink cannot escape it.
- **The published tarball is checked in CI** for `.p8`, `.p12`, `.mobileprovision`, `credentials.json`, `appstore.config.json` and `secrets/`.

## Your side

Git-ignore your `.p8`, `credentials.json`, `secrets/` and `appstore.config.json` — the last one carries your App Review contact details. Verify with `git check-ignore <file>`.

Give the API key the **App Manager** role. Nothing here needs Account Holder.
