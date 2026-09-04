// The age-rating declaration, as config rather than a constant.
//
// It used to be a hardcoded 21-key 4+ object, which meant an app with any mature
// content simply could not use this tool — there was no way to say otherwise.
//
// Two things Apple enforces that are easy to get wrong:
//   - The declaration must be COMPLETE. A partial PATCH returns 409, so every
//     key is always sent, defaulted rather than omitted.
//   - Never send ageRatingOverride together with ageRatingOverrideV2 (409).
//     We send neither.

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
export const FREQUENCY = Object.freeze(["NONE", "INFREQUENT_OR_MILD", "FREQUENT_OR_INTENSE"]);

/** Behavioural flags: booleans, defaulting to false. */
export const BEHAVIOURAL_FLAGS = Object.freeze([
  "advertising",
  "ageAssurance", // required — omitting it returns 409
  "gambling",
  "healthOrWellnessTopics",
  "lootBox",
  "messagingAndChat",
  "parentalControls",
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
  for (const key of CONTENT_DIMENSIONS) out[key] = source[key] ?? NONE;
  for (const key of BEHAVIOURAL_FLAGS) out[key] = source[key] ?? false;
  out.kidsAgeBand = source.kidsAgeBand ?? null;
  return out;
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
  if (!content.length && !flags.length) return declaration.kidsAgeBand ? `kids ${declaration.kidsAgeBand}` : "4+";
  return [...content.map((k) => `${k}=${declaration[k]}`), ...flags].join(", ");
}
