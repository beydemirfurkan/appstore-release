# Store metadata

`asc metadata` writes the listing for every configured locale and only sends what differs. `asc check` reports anything missing per locale, by name.

## Fields and limits

| Config key         | Lives on (API)                 | Limit | Required |
| ------------------ | ------------------------------ | ----- | -------- |
| `name`             | `appInfoLocalizations`         | 30    | yes      |
| `subtitle`         | `appInfoLocalizations`         | 30    |          |
| `privacyPolicyUrl` | `appInfoLocalizations`         | URL   | yes      |
| `description`      | `appStoreVersionLocalizations` | 4000  | yes      |
| `keywords`         | `appStoreVersionLocalizations` | 100 B | yes      |
| `promotionalText`  | `appStoreVersionLocalizations` | 170   |          |
| `supportUrl`       | `appStoreVersionLocalizations` | URL   | yes      |
| `marketingUrl`     | `appStoreVersionLocalizations` | URL   |          |
| `whatsNew`         | `appStoreVersionLocalizations` | 4000  | updates  |
| `copyright`        | `appStoreVersion` attribute    | —     | yes      |

Limits are characters, except keywords: Apple allows "up to 100 bytes" in UTF-8, so `ç`, `ş`, `ü` count two and Japanese or Chinese three. A Turkish list of 85 characters can be over. The validator checks every limit offline in every locale (`config.<path>.too-long`).

## What Apple rejects

- **Emoji in the description** → 409 `INVALID_CHARACTERS`. Use plain uppercase section headers; `•` and `—` are fine. Flagged offline as `config.<path>.emoji`.
- **`whatsNew` on a first version** → 409 `STATE_ERROR`. Leave it out until the second release; `check` reports `metadata.whatsNew.first-version` if it is set too early.
- **No `whatsNew` on an update** → the version cannot be submitted. Every version after the first needs it in every locale; `check` blocks with `metadata.whatsNew.missing`.
- **Keywords**: comma separated, 100 bytes total, each keyword longer than two characters. Spaces after commas waste bytes. Do not repeat words already in the name — Apple indexes the name anyway — and never use competitors' trademarks (guideline 2.3.7).
- **Screenshots, name or subtitle that misrepresent the app** (guideline 2.3). Metadata must describe the binary under review.
- **Other platforms in the metadata**: "Android", "Google Play", "Play Store" (guideline 2.3.10). Flagged as `config.<path>.other-platform`.
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

The first three lines show above the fold. Lead with the outcome, not the feature list. Then short uppercase-headed sections (KEY FEATURES, PRIVACY, SUBSCRIPTION TERMS). If the app has auto-renewing subscriptions, the description must state the price, period and that it renews automatically, with links to the terms and privacy policy (guideline 3.1.2). Without a custom EULA in App Store Connect, `check` warns `subscription.terms-link.missing` until the description links to terms — Apple's standard EULA works: `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`.

## Warnings `check` raises before Apple does

- **Placeholder text** (`config.*.placeholder`): "Lorem ipsum", "TBD", "FIXME", "TODO:", "[insert", "coming soon" anywhere in the listing. App Review rejects unfinished listings under Guideline 2.1. A plain "todo" is fine — plenty of apps are to-do apps.
- **Wasted keyword characters** (`config.*.keywords.wasted`): repeated keywords, words already in the name or subtitle (Apple indexes those already), and spaces after commas. The field is 100 bytes; spend each on a new search term.
- **Short keywords** (`config.*.keywords.short`): two characters or fewer in Latin script (`ai`, `tv`). Apple asks for keywords longer than two characters.
- **Subtitle repeating the name** (`config.*.subtitle.repeats-name`): both are searched, so a word in both is indexed once. Use the subtitle's 30 characters for new words.
