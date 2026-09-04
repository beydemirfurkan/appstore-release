// Write the age-rating declaration, which lives on appInfo rather than on the
// version — the version relationship 404s, which is a confusing first encounter.
//
// The whole attribute set is always sent: Apple rejects a partial declaration
// with a 409, and ageAssurance in particular is required.

import { Status } from "../core/status.mjs";
import { buildDeclaration, describeDeclaration } from "../core/age-rating.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "age-rating",
  title: "Age rating",
  phase: "listing",
  needs: [],
  mutates: true,
};

/** @param {import("../core/context.mjs").Context} ctx */
export async function run({ client, discovery, config }) {
  // `ageRating4Plus: false` used to mean "leave the declaration alone". It still
  // does, for configs written against v2.0.
  if (config?.ageRating4Plus === false && !config?.ageRating) {
    return { status: Status.SKIPPED, message: "age rating left as-is (ageRating4Plus is false)" };
  }

  const { info, included } = await discovery.appInfo();
  const declId =
    included.find((x) => x.type === "ageRatingDeclarations")?.id || info?.relationships?.ageRatingDeclaration?.data?.id;
  if (!declId) return { status: Status.ERROR, message: "age rating declaration not found on this app" };

  const wanted = buildDeclaration(config?.ageRating);

  const current = await client.get(`/v1/ageRatingDeclarations/${declId}`, { throwOnError: false });
  const attributes = current.error ? {} : (current.data?.attributes ?? {});
  const differs = Object.entries(wanted).some(([k, v]) => (attributes[k] ?? null) !== v);
  if (!differs) return { status: Status.OK, message: `${describeDeclaration(wanted)} already declared` };

  await client.patch(`/v1/ageRatingDeclarations/${declId}`, {
    data: { type: "ageRatingDeclarations", id: declId, attributes: wanted },
  });
  return { status: Status.CHANGED, message: describeDeclaration(wanted), details: { declaration: wanted } };
}
