# Accessibility Nutrition Labels

The App Store shows, per device, which accessibility features an app supports. App Store Connect keeps them as declarations, one per device family, each a draft until published. `asc accessibility` (also a `release` step) writes them from the config.

```json
"accessibility": {
  "publish": false,
  "url": "https://example.com/accessibility",
  "iphone": { "voiceover": true, "voiceControl": true, "largerText": true, "darkInterface": true,
              "differentiateWithoutColorAlone": true, "sufficientContrast": true, "reducedMotion": true,
              "captions": false, "audioDescriptions": false },
  "ipad": { "voiceover": true, "largerText": true }
}
```

- Devices: `iphone`, `ipad`, `mac`, `appleTv`, `appleWatch`, `vision`.
- A feature you leave out is declared as **not supported**. Claim only what someone can do in every common task of the app with that feature on — Apple's bar, and the one a user will hold you to.
- The first run writes drafts. `"publish": true` publishes them; a changed declaration becomes a new draft that replaces the published one when it is published.
- `url` is the app's accessibility page (App Information → Accessibility URL).

Ask the user which features they have tested on a device; do not infer support from the code. VoiceOver labels in the source do not mean every task works with VoiceOver.
