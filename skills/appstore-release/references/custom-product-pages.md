# Custom product pages

Alternative product pages, each with its own URL: one per ad campaign, season or audience, with its own promotional text, screenshots and previews, and an optional deep link into the app.

```json
"customProductPages": [
  {
    "name": "Ramadan",
    "deepLink": "myapp://ramadan",
    "visible": true,
    "locales": {
      "en-US": { "promotionalText": "A calm Ramadan.", "screenshots": "./cpp/ramadan/en", "previews": "./cpp/ramadan/previews" },
      "tr": { "promotionalText": "Huzurlu bir Ramazan.", "screenshots": "./cpp/ramadan/tr" }
    }
  }
]
```

```bash
asc custom-product-pages --dry-run
asc custom-product-pages     # also a release step
asc submit --submit          # sends an editable page version with the app
```

- A page is matched by `name`. Screenshots and previews are grouped by pixel size, exactly as on the product page.
- An approved page version cannot change. When the config differs from it — text, deep link, locales or any screenshot — a new version is created and the approved one keeps serving until the new one is approved. With nothing different, nothing is written.
- `visible: true` makes the page's URL live; the URL is in App Store Connect and in the page's `url`.
- Pages go to App Review: `submit` adds an editable page version to the same submission as the app version.
