// Sets the age-rating declaration to 4+ (all content NONE, all behavioural flags false).
// The declaration lives on appInfo, not the version. Never send both ageRatingOverride
// and ageRatingOverrideV2 (409); omit them entirely.
import { Status } from "../lib/log.mjs";

export const meta = { id: "age-rating", title: "Age rating", phase: "listing", needs: [] };

const N = "NONE";
const FOUR_PLUS = {
  // content dimensions (enums)
  sexualContentGraphicAndNudity: N, sexualContentOrNudity: N, horrorOrFearThemes: N, matureOrSuggestiveThemes: N,
  violenceCartoonOrFantasy: N, violenceRealistic: N, violenceRealisticProlongedGraphicOrSadistic: N,
  medicalOrTreatmentInformation: N, alcoholTobaccoOrDrugUseOrReferences: N, gamblingSimulated: N,
  profanityOrCrudeHumor: N, contests: N, gunsOrOtherWeapons: N,
  // behavioural flags (booleans)
  gambling: false, unrestrictedWebAccess: false, lootBox: false, advertising: false, userGeneratedContent: false,
  parentalControls: false, messagingAndChat: false, healthOrWellnessTopics: false, ageAssurance: false,
  kidsAgeBand: null,
};

export async function run({ client, discovery, config }) {
  if (config?.ageRating4Plus === false) return { status: Status.SKIPPED, message: "ageRating4Plus disabled in config" };

  const { info, included } = await discovery.appInfo();
  const declId = included.find((x) => x.type === "ageRatingDeclarations")?.id || info?.relationships?.ageRatingDeclaration?.data?.id;
  if (!declId) return { status: Status.ERROR, message: "age rating declaration not found" };

  await client.patch(`/v1/ageRatingDeclarations/${declId}`, {
    data: { type: "ageRatingDeclarations", id: declId, attributes: FOUR_PLUS },
  });
  return { status: Status.CHANGED, message: "4+" };
}
