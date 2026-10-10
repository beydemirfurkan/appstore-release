# Sales, analytics and product page tests

## Sales and Trends

```bash
asc sales                                   # yesterday's sales: units per title, proceeds per currency
asc sales --frequency MONTHLY --date 2026-09
asc sales --type SUBSCRIPTION --out ./reports/subs.tsv
```

- Needs an API key whose role can read reports (Sales and Reports access, such as Admin or Finance): an App Manager key is refused with 403. Keep a separate key for reports if the release key should stay App Manager.
- Needs the vendor number (App Store Connect → Payments and Financial Reports): `"reports": { "vendorNumber": "85012345" }`, `--vendor`, or `ASC_VENDOR_NUMBER`.
- Types: `SALES`, `PRE_ORDER` (daily, weekly, monthly, yearly); `SUBSCRIPTION`, `SUBSCRIPTION_EVENT`, `SUBSCRIBER`, `SUBSCRIPTION_OFFER_CODE_REDEMPTION` (daily). Dates: `YYYY-MM-DD` daily and weekly, `YYYY-MM` monthly, `YYYY` yearly; a daily report defaults to the latest.
- No sales on a day is reported as such, not as an error. Reports are read-only.

## Analytics reports

```bash
asc analytics --request      # once per app: Apple starts producing reports (the first take a day or two)
asc analytics                # what is available
asc analytics --report "App Store Discovery and Engagement Detailed" --out ./analytics
```

- The same key role applies: App Manager cannot read analytics reports.
- Downloads the report's latest instance (`--granularity DAILY|WEEKLY|MONTHLY`) into `--out`, one file per segment. Files are fetched from Apple's signed URLs; the API key is never sent with them.

## Product page tests (product page optimization)

```json
"experiments": [
  { "name": "Calmer screens", "trafficProportion": 50, "start": false,
    "treatments": [ { "name": "Calm", "appIconName": "AppIconCalm",
                      "locales": { "en-US": { "screenshots": "./ppo/calm/en" } } } ] }
]
```

```bash
asc experiments --dry-run
asc experiments           # also a release step
asc submit --submit       # sends a prepared test with the app; --skip-experiments leaves it out
```

- Up to three treatments. `trafficProportion` is the percent of visitors who see a treatment. `appIconName` names an alternate icon that is in the build.
- Edited only while prepared (or after a rejection); a treatment or locale removed from the config is removed. Nothing changes while it is in review.
- Once approved, a test starts only when the config says `"start": true`. If App Store Connect refuses a test with the app, it is taken back out and nothing is submitted.
