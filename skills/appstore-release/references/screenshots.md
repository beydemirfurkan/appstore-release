# Generating App Store screenshots

App Store requires exact-pixel PNGs. The largest iPhone slot the API accepts is **`APP_IPHONE_67` = 1290×2796** (covers 6.7″/6.9″). `appstore-release screenshots` uploads whatever PNGs are in `config.screenshots.dir` — this doc is how to _produce_ them.

Two honest options (ask the user):

1. **Real captures + frame** — run the app in the iOS Simulator, screenshot real screens, add a device frame + caption. Most accurate, lowest rejection risk.
2. **Designed, faithful mockups** — recreate the real screens in HTML from the code (exact colors, strings, layout) inside a device frame with a marketing caption. Fast, no simulator. **Must mirror the real app** — Apple rejects screenshots that misrepresent it.

## Method used here: HTML → headless Chrome → exact PNG

1. Build one self-contained HTML file with N `<section class="shot">` each `width:1290px; height:2796px` (inline CSS/SVG, no external requests — the renderer may be offline). Draw icons/charts/compasses as inline SVG. Use a system font stack; Arabic → `"Geeza Pro","Noto Naskh Arabic",serif`.
2. Render each section to a 1290×2796 PNG. **Playwright MCP** (`browser_take_screenshot` with `scale:"css"`, `target:"#shot-1"`) gives exact CSS-pixel PNGs — but `file:` is blocked, so serve first:
   ```bash
   (cd html_dir && python3 -m http.server 8799 &)   # then navigate http://localhost:8799/screens.html
   ```
   If the MCP browser hangs on "waiting for element to be stable", fall back to **headless Chrome** (one shot per page, or slice a tall render):
   ```bash
   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
   "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
     --window-size=1290,2796 --screenshot=shot-1.png "http://localhost:8799/shot-1.html"
   ```
3. Verify each: `sips -g pixelWidth -g pixelHeight -g hasAlpha file.png` → must be exactly 1290×2796. (App icons additionally need `hasAlpha: no`.)
4. Put the final PNGs in `config.screenshots.dir` (filename order = display order) and run `appstore-release screenshots`.

## Caption structure that worked

Per shot: premium background, a small gold uppercase eyebrow, a ~92px bold headline, a ~40px subheadline, then a device-framed screen (Dynamic Island + 9:41 status bar) bleeding off the bottom edge. Keep caption placement + device size consistent across all shots.

## Paywall review screenshot (for subscriptions)

The subscription review screenshot should clearly show the purchase UI: plan name, **price**, subscribe button, features, auto-renew fine print. Render full-screen (no marketing caption) at 1290×2796 and pass as `config.subscription.reviewScreenshot`.
