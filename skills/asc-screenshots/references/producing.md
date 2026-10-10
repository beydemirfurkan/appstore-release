# Producing App Store screenshots

`asc screenshots` uploads what is in the configured directories; this is how to make what goes in them. Ask the user which honest option they want:

1. **Real captures** — run the app, capture real screens, optionally add a frame and a caption. Most accurate, lowest rejection risk.
2. **Faithful mockups** — recreate the real screens in HTML from the code (exact colours, strings, layout) inside a device frame with a marketing caption. Fast, no simulator. **Must mirror the real app** — guideline 2.3.3 rejects screenshots that misrepresent it.

## A. Simulator capture (macOS + Xcode)

```bash
xcrun simctl list devices available | grep -E "iPhone 18 Pro Max|iPhone Duo|iPad Pro 13"
xcrun simctl boot "iPhone 18 Pro Max"
open -a Simulator
# Clean status bar: 9:41, full battery, full signal
xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiBars 3
# Navigate to each screen (deep links help: xcrun simctl openurl booted myapp://paywall), then:
xcrun simctl io booted screenshot --type=png shots/iphone/01-home.png
```

The Pro Max simulator captures at 1320×2868 — the 6.9" size. Use the iPhone Duo simulator (Xcode 27.1) once per display state for the outer and inner sets, and an iPad Pro 13" simulator for 2064×2752. Simulator PNGs have no alpha channel.

For many screens and locales, drive it from a UI test (`XCUIScreen.main.screenshot()`) and run with `-testLanguage tr -testRegion TR` per locale; fastlane `snapshot` is another route.

## B. HTML mockup → exact PNG (any OS)

1. Build one self-contained HTML file per shot (or one file with a `<section>` each), sized exactly — e.g. `width:1320px; height:2868px`. Inline all CSS, SVG and fonts; the renderer may be offline.
2. Render with headless Chrome or Chromium at device scale factor 1:

```bash
# macOS:   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Linux:   CHROME=$(command -v google-chrome || command -v chromium)
# Windows: CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1320,2868 --default-background-color=ffffffff \
  --screenshot=shots/iphone/01-home.png "file://$PWD/mockups/01-home.html"
```

`--default-background-color=ffffffff` keeps the PNG opaque. If `file:` URLs are blocked (Playwright MCP blocks them), serve the folder: `python3 -m http.server 8799` and use `http://localhost:8799/…`.

### Caption layout that works

A strong background, a small uppercase eyebrow, a ~92px bold headline (at 1320 wide), a ~40px subheadline, then the device-framed screen bleeding off the bottom edge. Keep caption position and device size identical across the set. One idea per screenshot; the first two carry most of the conversion.

## C. Check before uploading

```bash
# macOS
sips -g pixelWidth -g pixelHeight -g hasAlpha shots/iphone/*.png
# anywhere with Python
python3 -c "import struct,sys
for f in sys.argv[1:]:
  b=open(f,'rb').read(33); w,h=struct.unpack('>II',b[16:24]); print(f,w,h,'alpha' if b[25] in (4,6) else 'opaque')" shots/*/*.png
```

Remove an alpha channel without changing pixels: `sips -s format jpeg in.png --out out.jpg` (macOS), or `magick in.png -background white -alpha remove -alpha off out.png` (ImageMagick).

Then `asc screenshots --dry-run`.

## Paywall review screenshot (subscriptions)

The subscription review screenshot shows the purchase UI: plan name, **price**, subscribe button, what it unlocks, auto-renew terms. Capture it full-screen without a marketing caption and point `subscription.reviewScreenshot` at it. Any iPhone screenshot size is accepted.
