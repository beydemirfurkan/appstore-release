# Announcement

Attach the promo video (`appstore-release-promo.mp4` from the release; the square cut works better on LinkedIn).

## X (English)

Shipping an iOS app to App Store review is 40 clicks and a dozen 409s.

I made it one sentence to your agent: "publish my app for review."

appstore-release v3: a readiness report that knows what blocks submission, then an idempotent pipeline over the App Store Connect API. Updated for iOS 27: App Asset Library, iPhone Duo screenshots, subscriptions by API.

npx skills add beydemirfurkan/appstore-release

Try the whole flow with no Apple account: source scripts/demo/setup.sh

github.com/beydemirfurkan/appstore-release

## X (Türkçe)

Bir iOS uygulamasını App Store incelemesine göndermek 40 tıklama ve bir düzine 409 hatası demek.

Bunu ajanınıza söyleyeceğiniz tek cümleye indirdim: "uygulamamı incelemeye gönder."

appstore-release v3: neyin gönderimi engellediğini bilen bir hazırlık raporu ve App Store Connect API üzerinden idempotent bir pipeline. iOS 27 için güncel: App Asset Library, iPhone Duo ekran görüntüleri, yeni abonelikler API ile gönderiliyor.

npx skills add beydemirfurkan/appstore-release

Apple hesabı olmadan tüm akışı deneyin: source scripts/demo/setup.sh

github.com/beydemirfurkan/appstore-release

## LinkedIn (English)

Most App Store Connect integrations give an AI agent hundreds of endpoints, and with them every landmine: whatsNew returns 409 on a first version, an emoji in the description is a hard rejection, the age-rating declaration has to be sent complete, and a screenshot that skips its commit step is never shown.

appstore-release takes the opposite approach. It is a small set of outcome-shaped tools around one question: can this version be submitted, and if not, what comes next? Each finding says whether the tool can fix it or only App Store Connect's web UI can. Then an idempotent pipeline fixes everything the API allows, and submit refuses unless the report says ready.

v3.0.0 follows Apple's iOS 27 changes: screenshots through the new App Asset Library (the only way to upload iPhone Duo screenshots), new subscriptions submitted by API, and the 2026 age-rating questionnaire. It ships as six agent skills, an MCP server and a CLI, with no dependencies.

You can run the whole flow locally against a fake App Store Connect, no Apple account needed.

https://github.com/beydemirfurkan/appstore-release

## LinkedIn (Türkçe)

App Store Connect entegrasyonlarının çoğu bir yapay zekâ ajanına yüzlerce endpoint verir, mayınlarla birlikte: ilk sürümde whatsNew 409 döner, açıklamadaki bir emoji kesin red sebebidir, yaş derecelendirmesi eksiksiz gönderilmek zorundadır, commit adımı atlanan bir ekran görüntüsü hiç görünmez.

appstore-release tersini yapıyor: tek bir soru etrafında az sayıda, sonuç odaklı araç. Bu sürüm gönderilebilir mi, değilse sırada ne var? Her bulgu, onu aracın mı yoksa yalnızca App Store Connect arayüzünün mü düzeltebileceğini söylüyor. Ardından idempotent bir pipeline API'nin izin verdiği her şeyi düzeltiyor; rapor "hazır" demeden gönderim yapılmıyor.

v3.0.0, Apple'ın iOS 27 değişikliklerine uyumlu: ekran görüntüleri yeni App Asset Library üzerinden (iPhone Duo görsellerinin tek yolu), yeni abonelikler API ile gönderiliyor, 2026 yaş derecelendirme anketi destekleniyor. Altı ajan skill'i, bir MCP sunucusu ve bir CLI olarak geliyor; hiçbir bağımlılığı yok.

Tüm akışı Apple hesabı olmadan, yerelde sahte bir App Store Connect'e karşı deneyebilirsiniz.

https://github.com/beydemirfurkan/appstore-release
