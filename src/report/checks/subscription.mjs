// Subscriptions, and the second thing Apple keeps UI-only.

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
        title: `${productId} is MISSING_METADATA`,
        detail:
          "A subscription needs a group localization, its own localization, a price, and a review screenshot " +
          "before it reaches READY_TO_SUBMIT.",
        fix: "Fill it in from your config.",
        fixCommand: "appstore-release subscription",
        docs: "references/gotchas.md#subscriptions--iaps",
        evidence: { resource: "subscriptions", id: sub.id, actual: sub.state },
      }),
    );
  }

  // The API has no `subscription` relationship on reviewSubmissionItems, so a
  // first subscription genuinely cannot be attached to a version except by hand.
  if (sub.state === "READY_TO_SUBMIT") {
    out.push(
      finding({
        id: "subscription.first.ui-only",
        severity: Severity.BLOCKER,
        category: Category.ASC_STATE,
        title: `${productId} must be attached to the version by hand`,
        detail:
          "reviewSubmissionItems has no subscription relationship (409: 'subscription' is not a relationship), " +
          "so a first subscription cannot be submitted through the API. Later ones can.",
        fixOwner: FixOwner.UI,
        uiOnly: true,
        fix: "Attach it to the version and submit, in App Store Connect.",
        fixClicks: [
          "the version page",
          "In-App Purchases and Subscriptions",
          "Select",
          productId,
          "Save",
          "Add for Review",
          "Submit",
        ],
        docs: "references/gotchas.md#subscriptions--iaps",
      }),
    );
  }

  return out;
}
