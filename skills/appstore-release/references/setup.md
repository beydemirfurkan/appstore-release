# One-time setup

## 1. App Store Connect API key
1. https://appstoreconnect.apple.com/access/integrations/api → **Team Keys** tab → **+**.
2. Name it (e.g. `ci`), role **App Manager** → Generate.
3. **Download** `AuthKey_XXXXXXXXXX.p8` (only once — keep it safe, gitignore it).
4. Record **Key ID** (10 chars, in the row) and **Issuer ID** (UUID at the top of the page).

The same key authenticates: status queries, credential generation (Developer Portal certs/profiles), metadata/screenshot upload, and submission. The `.p8` is the secret — the Key ID and Issuer ID are not usable without it.

## 2. App record in App Store Connect
The app must already exist (Apps → +, or via API). Needs a registered **bundle id** (the `bundleIds` resource) matching the build's `CFBundleIdentifier`. `ASC_APP_ID` is the numeric app id from the app's ASC URL (`/apps/<ASC_APP_ID>/…`).

## 3. EAS / Expo
- `eas.json` with a `production` build profile; `eas login` done.
- Team id (`appleTeamId`) is on the Apple Developer account / eas.json submit profile.
- If EAS's stored iOS credentials are stale, use `node cli.mjs credentials` + `"credentialsSource":"local"` (see gotchas).

## 4. config.json
Copy `config-template.json`, fill it for the app, and point `APPSTORE_CONFIG` at it. Keep app-specific assets (screenshots dir, paywall image) referenced by relative/absolute paths the scripts can read.

## 5. Secrets hygiene
Gitignore before anything else: `*.p8`, `AuthKey_*.p8`, `credentials.json`, `*.p12`, `*.mobileprovision`, `dist.*`, and the `secrets/` dir. Verify with `git check-ignore <file>`.
```
*.p8
AuthKey_*.p8
credentials.json
*.p12
*.mobileprovision
dist.*
secrets/
```
