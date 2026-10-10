// What the app sells: every configured subscription and in-app purchase —
// whether it exists, whether it is complete, and how it reaches review.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";
import { isFirstProduct, purchaseConfigs, subscriptionConfigs } from "../../core/products.mjs";

export const section = { id: "subscription", title: "Purchases" };

/** Where App Store Connect's web UI attaches a first product to the version. */
const FIRST_PRODUCT_CLICKS = (/** @type {string} */ productId) => [
  "the version page",
  "In-App Purchases and Subscriptions",
  "Select",
  productId,
  "Done",
  "Add for Review",
  "Submit to App Review",
];

/** @param {{ snapshot: any, config: any }} input */
export function check({ snapshot, config }) {
  const out = [];
  const kinds = [
    {
      kind: "subscription",
      label: "Subscription",
      configured: subscriptionConfigs(config),
      remote: snapshot.subscriptions ?? [],
      command: "appstore-release subscription",
      canCreate: (/** @type {any} */ p) => Boolean(p.name && p.period),
      createWith: "name and period",
    },
    {
      kind: "iap",
      label: "In-app purchase",
      configured: purchaseConfigs(config),
      remote: snapshot.inAppPurchases ?? [],
      command: "appstore-release in-app-purchases",
      canCreate: (/** @type {any} */ p) => Boolean(p.name),
      createWith: "name",
    },
  ];

  for (const k of kinds) {
    // Apple: an app's first subscription — and first in-app purchase — goes to
    // review with the binary, from the website. Later ones go by API.
    const first = isFirstProduct(k.remote);
    for (const product of k.configured) {
      const { productId } = product;
      const remote = k.remote.find((r) => r.productId === productId);
      const suffix = k.configured.length > 1 ? `.${productId}` : "";

      if (!remote) {
        const creatable = k.canCreate(product);
        out.push(
          finding({
            id: `${k.kind}.not-found${suffix}`,
            category: Category.ASC_STATE,
            title: `${k.label} ${productId} does not exist yet`,
            detail: creatable
              ? "It is described in the config, and the tool will create it."
              : `The config names it but gives no ${k.createWith} to create it with.`,
            fixOwner: creatable ? FixOwner.CLI : FixOwner.CLI,
            fix: creatable
              ? "Create and complete it."
              : `Add ${k.createWith} to it in the config, or fix the product id.`,
            ...(creatable ? { fixCommand: k.command } : {}),
          }),
        );
        continue;
      }

      if (remote.state === "MISSING_METADATA") {
        out.push(
          finding({
            id: `${k.kind}.missing-metadata${suffix}`,
            category: Category.ASC_STATE,
            title: `${k.label} is missing metadata`,
            detail:
              `${productId} is MISSING_METADATA. It needs localizations, a price and a review screenshot ` +
              "before it reaches READY_TO_SUBMIT.",
            fix: "Fill it in from your config.",
            fixCommand: k.command,
            docs: "references/gotchas.md#subscriptions--iaps",
            evidence: { resource: k.kind, id: remote.id, actual: remote.state },
          }),
        );
      } else if (remote.state === "READY_TO_SUBMIT" && first) {
        out.push(
          finding({
            id: `${k.kind}.first.ui-only${suffix}`,
            severity: Severity.BLOCKER,
            category: Category.ASC_STATE,
            title: `The first ${k.label.toLowerCase()} is submitted from App Store Connect`,
            detail:
              `${productId} is ready, and it is the app's first ${k.label.toLowerCase()}. Apple requires the first ` +
              "one to go to review together with the app version, from the website; later ones can be submitted here.",
            fixOwner: FixOwner.UI,
            uiOnly: true,
            fix: "Attach it to the version and submit both, in App Store Connect.",
            fixClicks: FIRST_PRODUCT_CLICKS(productId),
            docs: "references/gotchas.md#subscriptions--iaps",
          }),
        );
      } else if (remote.state === "READY_TO_SUBMIT") {
        out.push(
          finding({
            id: `${k.kind}.ready-to-submit${suffix}`,
            severity: Severity.INFO,
            category: Category.ASC_STATE,
            title: `${productId} is ready and will be submitted with the version`,
            detail: `The app already has an approved ${k.label.toLowerCase()}, so this one goes by API, in the same review submission.`,
            fix: "Nothing; submit includes it.",
            fixCommand: "appstore-release submit --submit",
          }),
        );
      }
    }
  }
  return out;
}
