// The app-level declarations: price schedule, category, age rating, content rights.

import { finding, Category, FixOwner } from "../../core/findings.mjs";

export const section = { id: "store", title: "Pricing, category and ratings" };

/** @param {{ snapshot: any, config: any }} input */
export function check({ snapshot }) {
  const out = [];

  if (!snapshot.pricing?.hasSchedule) {
    out.push(
      finding({
        id: "pricing.schedule.missing",
        category: Category.ASC_STATE,
        title: "No price tier",
        detail:
          "Even a free app needs a price schedule; without one App Store Connect refuses 'Add for Review' " +
          'with "You must choose a price tier".',
        fix: "Set the price schedule from your config.",
        fixCommand: "appstore-release pricing",
        docs: "references/gotchas.md#pricing--availability",
      }),
    );
  }

  if (snapshot.app && !snapshot.app.attributes?.contentRightsDeclaration) {
    out.push(
      finding({
        id: "rights.declaration.missing",
        category: Category.ASC_STATE,
        title: "No content rights declaration",
        detail: "Apple requires a statement about third-party content before review.",
        fix: "Declare it from your config.",
        fixCommand: "appstore-release content-rights",
      }),
    );
  }

  const info = snapshot.appInfo;
  if (info && !info.relationships?.primaryCategory?.data) {
    out.push(
      finding({
        id: "category.primary.missing",
        category: Category.ASC_STATE,
        title: "No primary category",
        detail: "The App Store listing cannot be submitted without one.",
        fix: "Set category.primary in your config.",
        fixCommand: "appstore-release category",
      }),
    );
  }

  if (info && !info.relationships?.ageRatingDeclaration?.data) {
    out.push(
      finding({
        id: "rating.declaration.missing",
        category: Category.ASC_STATE,
        title: "No age rating declaration",
        detail:
          "The declaration lives on appInfos, not on the version, and needs the full attribute set " +
          "including ageAssurance — a partial one returns 409.",
        fix: "Write the declaration from your config.",
        fixCommand: "appstore-release age-rating",
        docs: "references/gotchas.md#age-rating-2025-schema",
      }),
    );
  }

  return out;
}
