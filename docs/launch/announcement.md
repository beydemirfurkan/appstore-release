# Announcement (4.0)

Attach `docs/media/hero.gif`, or the promo video from the 3.0.0 release. Link the repository, not the release page.

What to lead with: the preflight. Every other App Store Connect tool reads App Store Connect; this one also reads the app, where most rejections are.

What not to claim: that an app's first subscription is always accepted by API. It is tried, with the website as the fallback, and has not been seen on a live account yet.

## X (English)

Most App Store rejections aren't in App Store Connect. They're in your app: a camera prompt with no reason, accounts that can't be deleted, a paywall with no restore button.

appstore-release 4.0 checks the app itself before you build — offline, no Apple account — then fixes the listing over the API and submits only when nothing blocks it.

npx skills add beydemirfurkan/appstore-release

github.com/beydemirfurkan/appstore-release

## X (Türkçe)

App Store retlerinin çoğu App Store Connect'te değil, uygulamanın içinde: gerekçesiz bir kamera izni, silinemeyen hesaplar, geri yükleme düğmesi olmayan bir ödeme ekranı.

appstore-release 4.0 uygulamanın kendisini daha build almadan kontrol ediyor — çevrimdışı, Apple hesabı gerekmeden — sonra mağaza sayfasını API üzerinden düzeltiyor ve hiçbir engel kalmadığında gönderiyor.

npx skills add beydemirfurkan/appstore-release

github.com/beydemirfurkan/appstore-release

## LinkedIn (English)

App Store Connect integrations give an AI agent the API. That covers the listing — and misses where most rejections come from: the app itself.

appstore-release 4.0 adds an offline preflight. It reads an Expo or Xcode project — Info.plist, privacy manifest, source — and reports what App Review rejects, each with the guideline and the file and line: purpose strings that say nothing, invalid required-reason codes, third-party login without an equivalent private option, account creation without deletion, a paywall without restore. Only what it can be certain of blocks; the rest are warnings you can waive with a reason on record.

Then the part that was already there: a readiness report that says what blocks submission and who can fix it, an idempotent pipeline that fixes everything Apple's API allows, and a submit that refuses unless the report says ready.

Nine agent skills, an MCP server and a CLI, no dependencies. It runs locally against a fake App Store Connect if you want to try it without an Apple account.

https://github.com/beydemirfurkan/appstore-release

## LinkedIn (Türkçe)

App Store Connect entegrasyonları yapay zekâ ajanına API'yi veriyor. Bu, mağaza sayfasını kapsıyor; retlerin çoğunun geldiği yeri, yani uygulamanın kendisini kaçırıyor.

appstore-release 4.0 çevrimdışı bir ön kontrol ekliyor. Expo ya da Xcode projesini — Info.plist, privacy manifest, kaynak kod — okuyup App Review'un neyi reddedeceğini yönerge numarası, dosya ve satırıyla söylüyor: hiçbir şey anlatmayan izin metinleri, geçersiz required-reason kodları, eşdeğer gizli seçeneği olmayan üçüncü taraf girişler, silinemeyen hesaplar, geri yükleme düğmesi olmayan ödeme ekranları. Yalnızca kesin olanlar engelliyor; gerisi gerekçesi kayda geçirilerek geçilebilen uyarılar.

Sonra önceden de olan kısım: gönderimi neyin engellediğini ve kimin düzeltebileceğini söyleyen bir hazırlık raporu, Apple API'sinin izin verdiği her şeyi düzelten idempotent bir akış ve rapor "hazır" demeden gönderim yapmayan bir submit.

Dokuz ajan skill'i, bir MCP sunucusu ve bir CLI; hiçbir bağımlılığı yok. Apple hesabı olmadan denemek için yerelde sahte bir App Store Connect'e karşı çalışıyor.

https://github.com/beydemirfurkan/appstore-release

## Reddit (r/iOSProgramming, r/reactnative, r/expo)

Check each subreddit's self-promotion rule first (some allow it only on a set day or in a weekly thread). Post as a maker, answer questions, and do not cross-post the same text everywhere on the same day.

**Title:** I built an open-source tool that checks your iOS app for App Review rejections before you submit

**Body:**

I kept losing review cycles to things that were in the app, not the listing: a purpose string Apple called vague, no in-app account deletion, a paywall without a restore button. So I added an offline preflight to my App Store release tool.

`appstore-release preflight` reads an Expo or Xcode project — app.json with Expo's plugin precedence, Info.plist, INFOPLIST_KEY_ build settings, PrivacyInfo.xcprivacy and the source — and reports what App Review tends to reject, with the guideline and file:line. It needs no Apple account and sends nothing anywhere. Certain problems (an invalid required-reason code) block; inferred ones are warnings you can waive with a reason.

The rest of the tool fills the listing over the App Store Connect API (every locale, screenshots incl. iPhone Duo, price, age rating, subscriptions) and refuses to submit unless nothing blocks it. It's MIT, zero-dependency Node, usable as a CLI, an MCP server or agent skills.

What I'd love feedback on: false positives on your project. `npx github:beydemirfurkan/appstore-release preflight` in your app's folder.

https://github.com/beydemirfurkan/appstore-release
