# Store metadata

`asc metadata` writes the listing for every configured locale and only sends what differs. `asc check` reports anything missing per locale, by name.

## Fields and limits

| Config key         | Lives on (API)                 | Limit | Required |
| ------------------ | ------------------------------ | ----- | -------- |
| `name`             | `appInfoLocalizations`         | 30    | yes      |
| `subtitle`         | `appInfoLocalizations`         | 30    |          |
| `privacyPolicyUrl` | `appInfoLocalizations`         | URL   | yes      |
| `description`      | `appStoreVersionLocalizations` | 4000  | yes      |
| `keywords`         | `appStoreVersionLocalizations` | 100   | yes      |
| `promotionalText`  | `appStoreVersionLocalizations` | 170   |          |
| `supportUrl`       | `appStoreVersionLocalizations` | URL   | yes      |
| `marketingUrl`     | `appStoreVersionLocalizations` | URL   |          |
| `whatsNew`         | `appStoreVersionLocalizations` | 4000  | updates  |
| `copyright`        | `appStoreVersion` attribute    | —     | yes      |

Limits are characters, not bytes. The validator checks them offline in every locale (`config.<path>.too-long`).

## What Apple rejects

- **Emoji in the description** → 409 `INVALID_CHARACTERS`. Use plain uppercase section headers; `•` and `—` are fine. Flagged offline as `config.<path>.emoji`.
- **`whatsNew` on a first version** → 409 `STATE_ERROR`. Leave it out until the second release; `check` reports `metadata.whatsNew.first-version` if it is set too early.
- **Keywords**: comma separated, 100 characters total. Spaces after commas waste characters. Do not repeat words already in the name — Apple indexes the name anyway — and never use competitors' trademarks (guideline 2.3.7).
- **Screenshots, name or subtitle that misrepresent the app** (guideline 2.3). Metadata must describe the binary under review.
- **Price in the name or subtitle**, or words like "free" next to in-app purchases (guideline 2.3.7).
- **A privacy policy URL that 404s** or does not describe the app's data use (guideline 5.1.1).

## Several languages

`metadata` is the default for every locale; `locales` overrides only what differs. Ask the user for the translations, not for every field again:

```json
"locale": "en-US",
"metadata": { "name": "Wellness", "description": "...", "keywords": "...", "supportUrl": "...", "privacyPolicyUrl": "..." },
"locales": {
  "en-US": {},
  "tr": { "name": "Wellness", "description": "...", "keywords": "..." },
  "de-DE": { "description": "...", "keywords": "..." }
}
```

- Keys are App Store locale codes (`en-US`, `tr`, `de-DE`, `pt-BR`, `zh-Hans`…). A locale not in the config is left alone and reported as `metadata.locale.unmanaged`.
- A locale subdirectory under a screenshot directory (`./shots/tr/`) overrides that directory for that locale.
- URLs usually stay the same across locales — leave them to inherit.

## Writing a description that converts

The first three lines show above the fold. Lead with the outcome, not the feature list. Then short uppercase-headed sections (KEY FEATURES, PRIVACY, SUBSCRIPTION TERMS). If the app has auto-renewing subscriptions, the description must state the price, period and that it renews automatically, with links to the terms and privacy policy (guideline 3.1.2).
