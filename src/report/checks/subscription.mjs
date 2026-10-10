// Subscriptions: whether the configured one exists, is complete, and goes to review.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";

export const section = { id: "subscription", title: "Subscriptions" };

/** @param {{ snapshot: any, config: any }} input */
export function check({ snapshot, config }) {
  const out = [];
  const productId = config?.subscription?.productId;
  if (!productId) return out;

  const sub = snapshot.subscriptions.find((s) => s.productId === productId);
  if (!sub) {
    out.push(
      finding({
        id: "subscription.not-found",
        category: Category.ASC_STATE,
        title: `Subscription ${productId} does not exist`,
        detail: "The config names a product id that is not in any subscription group for this app.",
        fixOwner: FixOwner.UI,
        fix: "Create the subscription in App Store Connect, or correct config.subscription.productId.",
        fixClicks: ["App Store Connect", "your app", "Subscriptions", "+"],
      }),
    );
    return out;
  }

  if (sub.state === "MISSING_METADATA") {
    out.push(
      finding({
        id: "subscription.missing-metadata",
        category: Category.ASC_STATE,
        title: "Subscription is missing metadata",
        detail:
          `${productId} is MISSING_METADATA. A subscription needs a group localization, its own localization, ` +
          "a price, and a review screenshot before it reaches READY_TO_SUBMIT.",
        fix: "Fill it in from your config.",
        fixCommand: "appstore-release subscription",
        docs: "references/gotchas.md#subscriptions--iaps",
        evidence: { resource: "subscriptions", id: sub.id, actual: sub.state },
      }),
    );
  }

  // Since API 4.4.1 a subscription has versions that review submissions accept,
  // so READY_TO_SUBMIT is no longer a hand-off: `submit` adds the subscription
  // (and its group, for a new one) to the same submission as the app version.
  if (sub.state === "READY_TO_SUBMIT") {
    out.push(
      finding({
        id: "subscription.ready-to-submit",
        severity: Severity.INFO,
        category: Category.ASC_STATE,
        title: `${productId} is ready and will be submitted with the version`,
        detail:
          "submit adds its subscription version — and its group's, if the group was never approved — to the same " +
          "review submission, as Apple requires for a first subscription.",
        fix: "Nothing; submit includes it.",
        fixCommand: "appstore-release submit --submit",
      }),
    );
  }

  return out;
}
