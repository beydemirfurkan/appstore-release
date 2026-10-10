---
name: app-store-age-rating
description: Answer Apple's App Store age-rating questionnaire (the 2025–2026 version with 13+, 16+ and 18+ tiers, age assurance, and the social media questions required since September 2026) and write it through the App Store Connect API in one complete, valid declaration. Use when the user asks "what age rating will my app get", "fill out the age rating", "content descriptions", "social media questions", "age assurance", "rating is 409ing", or when an App Store readiness check reports rating.* findings.
license: MIT
compatibility: Node.js 20.11+ and network access to api.appstoreconnect.apple.com with an App Store Connect API key (App Manager).
metadata:
  author: Furkan Beydemir
  version: "4.3.1"
  guidelines: "2026-06-08"
---

# Age rating

> **You say:** _"What age rating should my app get?"_ · _"Answer the new social media questions."_
>
> **It does:** Walks the 2026 questionnaire with you in plain words, then writes the complete declaration App Store Connect requires — 4+, 9+, 13+, 16+ or 18+.

Apple derives the rating (4+, 9+, 13+, 16+, 18+) from a questionnaire. The API stores the answers as one `ageRatingDeclaration` on the app's App Info, and it only accepts a **complete** set — a partial PATCH 409s. This tool always sends every attribute; you only decide the answers.

## Running the CLI

```bash
node <skill-dir>/scripts/asc.mjs <command> [flags]
```

`<skill-dir>` is the directory you loaded this SKILL.md from. Below, `asc` means that line. Credentials come from the environment only.

## 1. Interview the user — in their words, not Apple's

Ask about what the app actually contains; never guess "NONE" for content you have not seen. The questions, and the config key each answer sets, are in [references/questionnaire.md](references/questionnaire.md). Ask in batches:

1. **Content** — violence, sexual content, profanity, horror, drugs/alcohol, mature themes, medical information, weapons, simulated gambling, contests. Each is `NONE`, `INFREQUENT` or `FREQUENT`.
2. **Capabilities** — user-generated content, messaging or chat, **social media features** (profiles, following, feeds), unrestricted web browsing, advertising, loot boxes, real-money gambling, health or wellness topics.
3. **Controls** — parental controls, age assurance (does the app verify age?), and whether social features are restricted by age.

## 2. Write the config

Only what is not `NONE`/`false` needs to be written — everything omitted is sent as `NONE` or `false`:

```json
"ageRating": {
  "profanityOrCrudeHumor": "INFREQUENT",
  "userGeneratedContent": true,
  "messagingAndChat": true,
  "socialMedia": true,
  "socialMediaAgeRestricted": true,
  "parentalControls": false,
  "ageAssurance": false
}
```

- `override` forces a higher rating than the answers produce: `NINE_PLUS`, `THIRTEEN_PLUS`, `SIXTEEN_PLUS`, `EIGHTEEN_PLUS`, or `UNRATED`; `NONE` means no override. It is sent as `ageRatingOverrideV2` — never the deprecated `ageRatingOverride`, and never both (409).
- `INFREQUENT_OR_MILD` / `FREQUENT_OR_INTENSE` from older configs are accepted and mapped to `INFREQUENT` / `FREQUENT`.
- `kidsAgeBand` is deprecated by Apple and no longer sent. Apps in the Kids category set it in App Store Connect.
- `ageRating4Plus: true` from v1 configs still means "everything NONE/false".

## 3. Apply and verify

```bash
asc age-rating --dry-run   # the full declaration that would be sent, and what differs
asc age-rating
asc check                  # rating.declaration.missing should be gone
```

Tell the user the resulting tier. App Store Connect shows it per territory (App Information → Age Rating); some territories (Korea, Brazil, Vietnam) rate separately.

## Judgement calls

- **User-generated content or chat** → Apple also expects moderation: a way to report content, block users, and filter objectionable material (guideline 1.2). Ask whether the app has them; if not, that is a likely rejection, not an age-rating question.
- **AI chat or generated content** counts as user-generated content and unrestricted content unless the output is filtered — answer conservatively.
- **Health or wellness topics** is `true` for fitness, diet, meditation, period tracking; `medicalOrTreatmentInformation` is for diagnosis or treatment content. Apps in Health & Fitness or Medical may also need the EU/UK/US regulated-medical-device declaration in App Store Connect (UI only).
- **Web views** that can reach arbitrary sites → `unrestrictedWebAccess: true`, which rates 18+ unless restricted.
- **Loot boxes** are `lootBox: true`; simulated casino games are `gamblingSimulated`; real-money gambling is `gambling: true` and needs licensing (guideline 5.3).

## When it fails

| Error                                                | Fix                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 409 naming a missing attribute (e.g. `socialMedia`)  | Apple added a question. Update this tool; meanwhile it is a config-key gap, report it. |
| 409 on `ageRatingOverride` and `ageRatingOverrideV2` | Something else sent the old key. This tool only sends V2.                              |
| 404 on `appStoreVersions/{id}/ageRatingDeclaration`  | That path was removed in API 4.3; the declaration lives on `appInfos`.                 |
| Rating higher than expected                          | Check `unrestrictedWebAccess`, `gambling` and `override` first.                        |

_Checked against the App Store Review Guidelines of June 8, 2026._
