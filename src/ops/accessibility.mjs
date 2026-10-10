// Accessibility Nutrition Labels: per device family, which accessibility
// features the app supports (App Store Connect API 4.5.1,
// accessibilityDeclarations). The config lists what the app supports; a feature
// left out is declared as not supported, never guessed.
//
// A declaration is a draft until published. This keeps one draft per device in
// step with the config and publishes it only when `accessibility.publish` is
// true — publishing is what puts the label on the App Store.

import { Status } from "../core/status.mjs";

/** Config key → API attribute. */
export const FEATURES = Object.freeze({
  voiceover: "supportsVoiceover",
  voiceControl: "supportsVoiceControl",
  largerText: "supportsLargerText",
  darkInterface: "supportsDarkInterface",
  differentiateWithoutColorAlone: "supportsDifferentiateWithoutColorAlone",
  sufficientContrast: "supportsSufficientContrast",
  reducedMotion: "supportsReducedMotion",
  captions: "supportsCaptions",
  audioDescriptions: "supportsAudioDescriptions",
});

/** Config key → API device family. */
export const FAMILIES = Object.freeze({
  iphone: "IPHONE",
  ipad: "IPAD",
  mac: "MAC",
  appleTv: "APPLE_TV",
  appleWatch: "APPLE_WATCH",
  vision: "VISION",
});

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "accessibility",
  title: "Accessibility labels",
  phase: "listing",
  needs: [],
  mutates: true,
};

/**
 * The attributes a device's declaration should have: every feature, true or false.
 * @param {Record<string, boolean>} declared
 */
export function wantedAttributes(declared) {
  return Object.fromEntries(Object.entries(FEATURES).map(([key, attr]) => [attr, declared?.[key] === true]));
}

/** @param {import("../core/context.mjs").Context} ctx */
export async function run({ client, discovery, config }) {
  const a = config?.accessibility;
  const families = Object.entries(FAMILIES).filter(([key]) => a?.[key]);
  if (!a || (!families.length && !a.url)) return { status: Status.SKIPPED, message: "none configured" };

  const changes = [];
  const appId = discovery.appId;

  if (a.url) {
    const app = await client.get(`/v1/apps/${appId}?fields[apps]=accessibilityUrl`);
    if ((app.data?.attributes?.accessibilityUrl ?? "") !== a.url) {
      await client.patch(`/v1/apps/${appId}`, {
        data: { type: "apps", id: appId, attributes: { accessibilityUrl: a.url } },
      });
      changes.push("accessibility URL");
    }
  }

  const existing = families.length
    ? await client.all(`/v1/apps/${appId}/accessibilityDeclarations`, { limit: 50 })
    : [];

  for (const [key, family] of families) {
    const want = wantedAttributes(a[key]);
    const mine = existing.filter((d) => d.attributes?.deviceFamily === family);
    const published = mine.find((d) => d.attributes?.state === "PUBLISHED");
    const draft = mine.find((d) => d.attributes?.state === "DRAFT");
    const same = (/** @type {any} */ d) =>
      Object.entries(want).every(([attr, v]) => (d.attributes?.[attr] ?? false) === v);

    // Already on the App Store as configured, and nothing pending: done.
    if (published && same(published) && !draft) continue;

    let target = draft;
    if (target && !same(target)) {
      await client.patch(`/v1/accessibilityDeclarations/${target.id}`, {
        data: { type: "accessibilityDeclarations", id: target.id, attributes: want },
      });
      changes.push(`${key} updated`);
    } else if (!target) {
      target = (
        await client.post(`/v1/accessibilityDeclarations`, {
          data: {
            type: "accessibilityDeclarations",
            attributes: { deviceFamily: family, ...want },
            relationships: { app: { data: { type: "apps", id: appId } } },
          },
        })
      ).data;
      changes.push(`${key} drafted`);
    }

    if (a.publish && target) {
      await client.patch(`/v1/accessibilityDeclarations/${target.id}`, {
        data: { type: "accessibilityDeclarations", id: target.id, attributes: { publish: true } },
      });
      changes.push(`${key} published`);
    }
  }

  return changes.length
    ? {
        status: Status.CHANGED,
        message: changes.join(" · ") + (a.publish ? "" : " (drafts; set accessibility.publish to publish)"),
      }
    : { status: Status.OK, message: "labels match the config" };
}
