// The age-rating declaration, as config rather than a constant.
//
// It used to be a hardcoded 4+ object, which meant an app with any mature
// content simply could not use this tool — there was no way to say otherwise.
//
// Things Apple enforces that are easy to get wrong:
//   - The declaration must be COMPLETE. A partial PATCH returns 409, so every
//     key is always sent, defaulted rather than omitted.
//   - Never send ageRatingOverride together with ageRatingOverrideV2 (409).
//     The deprecated one is never sent; V2 only when the config asks for it.
//   - The 2025 questionnaire renamed the frequencies: INFREQUENT_OR_MILD and
//     FREQUENT_OR_INTENSE are deprecated for INFREQUENT and FREQUENT. Old configs
//     keep working; the new values are what goes over the wire.
//   - socialMedia and socialMediaAgeRestricted (API 4.4.1) are required for new
//     apps and updates since September 2026.

const NONE = "NONE";

/** Content dimensions: enums, defaulting to NONE. */
export const CONTENT_DIMENSIONS = Object.freeze([
  "alcoholTobaccoOrDrugUseOrReferences",
  "contests",
  "gamblingSimulated",
  "gunsOrOtherWeapons",
  "horrorOrFearThemes",
  "matureOrSuggestiveThemes",
  "medicalOrTreatmentInformation",
  "profanityOrCrudeHumor",
  "sexualContentGraphicAndNudity",
  "sexualContentOrNudity",
  "violenceCartoonOrFantasy",
  "violenceRealistic",
  "violenceRealisticProlongedGraphicOrSadistic",
]);

/** How much of a thing there is. */
export const FREQUENCY = Object.freeze(["NONE", "INFREQUENT", "FREQUENT"]);

/** Pre-2025 spellings, still accepted in a config and still returned for old declarations. */
export const LEGACY_FREQUENCY = Object.freeze({ INFREQUENT_OR_MILD: "INFREQUENT", FREQUENT_OR_INTENSE: "FREQUENT" });

/** Apple's own rating override (`ageRatingOverrideV2`); only sent when configured. */
export const RATING_OVERRIDES = Object.freeze([
  "NONE",
  "NINE_PLUS",
  "THIRTEEN_PLUS",
  "SIXTEEN_PLUS",
  "EIGHTEEN_PLUS",
  "UNRATED",
]);

/** @param {unknown} value */
export const normalizeFrequency = (value) =>
  typeof value === "string" ? /** @type {Record<string,string>} */ (LEGACY_FREQUENCY[value] ?? value) : value;

/** Behavioural flags: booleans, defaulting to false. */
export const BEHAVIOURAL_FLAGS = Object.freeze([
  "advertising",
  "ageAssurance", // required — omitting it returns 409
  "gambling",
  "healthOrWellnessTopics",
  "lootBox",
  "messagingAndChat",
  "parentalControls",
  "socialMedia", // API 4.4.1; required since September 2026
  "socialMediaAgeRestricted",
  "unrestrictedWebAccess",
  "userGeneratedContent",
]);

export const KIDS_AGE_BANDS = Object.freeze(["FIVE_AND_UNDER", "SIX_TO_EIGHT", "NINE_TO_ELEVEN"]);

/**
 * Build a complete declaration from whatever the config specifies.
 *
 * @param {object|null|undefined} declared   config.ageRating
 * @returns {Record<string, any>}
 */
export function buildDeclaration(declared = {}) {
  const source = declared ?? {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of CONTENT_DIMENSIONS) out[key] = normalizeFrequency(source[key]) ?? NONE;
  for (const key of BEHAVIOURAL_FLAGS) out[key] = source[key] ?? false;
  out.kidsAgeBand = source.kidsAgeBand ?? null;
  if (source.override) out.ageRatingOverrideV2 = source.override;
  return out;
}

/**
 * Whether what App Store Connect holds already says what we would send. Its
 * frequencies are normalised first: an old declaration reading INFREQUENT_OR_MILD
 * is the same answer as INFREQUENT, not a change.
 *
 * @param {Record<string, any>} wanted
 * @param {Record<string, any>} current
 */
export function declarationMatches(wanted, current) {
  return Object.entries(wanted).every(([k, v]) => (normalizeFrequency(current[k]) ?? null) === v);
}

/** True when the declaration says nothing but "no mature content anywhere". */
export function isFourPlus(declaration) {
  return (
    CONTENT_DIMENSIONS.every((k) => declaration[k] === NONE) &&
    BEHAVIOURAL_FLAGS.every((k) => declaration[k] === false) &&
    declaration.kidsAgeBand == null
  );
}

/** A short human label for what was declared. */
export function describeDeclaration(declaration) {
  const content = CONTENT_DIMENSIONS.filter((k) => declaration[k] && declaration[k] !== NONE);
  const flags = BEHAVIOURAL_FLAGS.filter((k) => declaration[k] === true);
  const override = declaration.ageRatingOverrideV2 ? [`override ${declaration.ageRatingOverrideV2}`] : [];
  if (!content.length && !flags.length) {
    return [declaration.kidsAgeBand ? `kids ${declaration.kidsAgeBand}` : "4+", ...override].join(", ");
  }
  return [...content.map((k) => `${k}=${declaration[k]}`), ...flags, ...override].join(", ");
}
