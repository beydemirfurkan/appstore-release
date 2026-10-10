# The age-rating questionnaire, mapped to config keys

Apple's definitions: <https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions>. Tiers: **4+, 9+, 13+, 16+, 18+** (13+, 16+ and 18+ replaced 12+ and 17+ in 2025).

## Content — `NONE`, `INFREQUENT` or `FREQUENT`

| Config key                                    | Ask the user                                                    |
| --------------------------------------------- | --------------------------------------------------------------- |
| `violenceCartoonOrFantasy`                    | Cartoon or fantasy violence (stylised, non-realistic)?          |
| `violenceRealistic`                           | Realistic violence?                                             |
| `violenceRealisticProlongedGraphicOrSadistic` | Prolonged, graphic or sadistic realistic violence?              |
| `sexualContentOrNudity`                       | Sexual content or nudity?                                       |
| `sexualContentGraphicAndNudity`               | Graphic sexual content and nudity?                              |
| `profanityOrCrudeHumor`                       | Profanity or crude humour?                                      |
| `matureOrSuggestiveThemes`                    | Mature or suggestive themes?                                    |
| `horrorOrFearThemes`                          | Horror or fear themes?                                          |
| `alcoholTobaccoOrDrugUseOrReferences`         | Alcohol, tobacco or drug use or references?                     |
| `medicalOrTreatmentInformation`               | Medical or treatment information (diagnosis, treatment advice)? |
| `gunsOrOtherWeapons`                          | Realistic depictions of guns or other weapons?                  |
| `gamblingSimulated`                           | Simulated gambling (casino games without real money)?           |
| `contests`                                    | Contests (sweepstakes, competitions with prizes)?               |

`INFREQUENT` = occasional or mild; `FREQUENT` = recurring or intense. When in doubt between the two, pick the higher — under-rating is a rejection reason, over-rating is not.

## Capabilities and controls — `true` or `false`

| Config key                 | Ask the user                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `userGeneratedContent`     | Can users post content others see (text, images, AI output shared with others)?             |
| `messagingAndChat`         | Can users message or chat with each other?                                                  |
| `socialMedia`              | Social features — public profiles, following, feeds, likes? (required since September 2026) |
| `socialMediaAgeRestricted` | Are those social features restricted by age (e.g. off for under-16s)?                       |
| `unrestrictedWebAccess`    | Can users browse arbitrary websites inside the app?                                         |
| `advertising`              | Does the app show ads?                                                                      |
| `lootBox`                  | Paid random rewards (loot boxes, gacha)?                                                    |
| `gambling`                 | Real-money gambling?                                                                        |
| `healthOrWellnessTopics`   | Health, fitness, diet, mental wellness or similar topics?                                   |
| `parentalControls`         | Does the app offer parental controls?                                                       |
| `ageAssurance`             | Does the app verify or estimate the user's age (e.g. Declared Age Range API, ID check)?     |

All eleven booleans and all thirteen content dimensions are sent on every PATCH. Missing any one of them → 409.

## Override — `ageRating.override`

| Value           | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `NONE`          | Use the rating the answers produce (default)                   |
| `NINE_PLUS`     | At least 9+                                                    |
| `THIRTEEN_PLUS` | At least 13+                                                   |
| `SIXTEEN_PLUS`  | At least 16+                                                   |
| `EIGHTEEN_PLUS` | 18+                                                            |
| `UNRATED`       | Not rated (not available on the App Store in most territories) |

Sent as `ageRatingOverrideV2`. An override can raise the rating, not lower it.

## Territory ratings

Apple computes a per-territory rating from the same answers; `GET /v1/appInfos/{id}/territoryAgeRatings` reads them. Korea (GRAC) and Brazil have their own classification fields that App Store Connect asks for only when relevant.
