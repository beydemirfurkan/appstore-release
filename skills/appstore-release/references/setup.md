# One-time setup

## 1. App Store Connect API key

1. https://appstoreconnect.apple.com/access/integrations/api → **Team Keys** tab → **+**.
2. Name it (e.g. `ci`), role **App Manager** → Generate. (The App Asset Library, which screenshots now go through, also accepts Admin or Account Holder.)
3. **Download** `AuthKey_XXXXXXXXXX.p8` — Apple offers it only once. Keep it out of the repository.
4. Record the **Key ID** (10 characters, in the key's row) and the **Issuer ID** (the UUID at the top of the page).

The same key authenticates everything this tool does: status, certificates and profiles, metadata, screenshots, subscriptions and submission. The `.p8` is the secret; the Key ID and Issuer ID are useless without it.

```bash
export ASC_KEY_ID=ABCDE12345
export ASC_ISSUER_ID=69a6de00-0000-0000-0000-000000000000
export ASC_P8_PATH=/abs/path/AuthKey_ABCDE12345.p8   # or ASC_P8="$(cat AuthKey.p8)"
export ASC_APP_ID=1234567890
```

**Never** pass these as MCP tool arguments or paste them into chat: tool arguments land in transcripts and host logs, and a leaked `.p8` cannot be rotated without breaking every other integration using it. No tool in this package accepts them as arguments.

## 2. App record in App Store Connect

The app must already exist (Apps → **+**). It needs a registered bundle id matching the build's `CFBundleIdentifier`. `ASC_APP_ID` is the numeric id in the app's App Store Connect URL (`/apps/<ASC_APP_ID>/…`) — not the bundle id. If you only know the name or bundle id, the MCP tool `asc_list_apps` finds it.

## 3. EAS / Expo (only if the build comes from EAS)

- `eas.json` with a `production` build profile, and `eas login` done.
- The team id (`appleTeamId`) is on the Apple Developer account and in the eas.json submit profile.
- If EAS's stored iOS credentials are stale, see the **asc-credentials** skill (`asc credentials`, then `"credentialsSource": "local"`).

## 4. The config file

```bash
asc init        # writes ./appstore.config.json with a $schema for editor autocomplete
asc validate    # offline check — no credentials, no network
```

The CLI looks for `appstore.config.json` in the current directory; `--config <path>` or `APPSTORE_CONFIG=<path>` points elsewhere. Relative paths inside it (screenshot directories, the paywall image) resolve against the config file. [config-template.json](config-template.json) shows every block filled in.

## 5. Secrets hygiene

Ignore these before anything else, then verify with `git check-ignore <file>`:

```
*.p8
AuthKey_*.p8
credentials.json
*.p12
*.mobileprovision
dist.*
secrets/
```

The `credentials` command writes its output `0600` into a `0700` directory and reports any secret file that git would not ignore.
