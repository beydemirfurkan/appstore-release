// Subscriptions: whether the configured one exists, is complete, and goes to review.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";
import { isFirstSubscription } from "../../core/subscriptions.mjs";

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

  if (sub.state === "READY_TO_SUBMIT" && isFirstSubscription(snapshot.subscriptions)) {
    // Apple: the app's first subscription is submitted together with the binary
    // through appstoreconnect.apple.com. Later ones go through the API.
    out.push(
      finding({
        id: "subscription.first.ui-only",
        severity: Severity.BLOCKER,
        category: Category.ASC_STATE,
        title: "The first subscription is submitted from App Store Connect",
        detail:
          `${productId} is ready, and it is the app's first subscription. Apple requires the first one to go to ` +
          "review together with the app version, from the website; every later subscription can be submitted here.",
        fixOwner: FixOwner.UI,
        uiOnly: true,
        fix: "Attach it to the version and submit both, in App Store Connect.",
        fixClicks: [
          "the version page",
          "In-App Purchases and Subscriptions",
          "Select",
          productId,
          "Done",
          "Add for Review",
          "Submit to App Review",
        ],
        docs: "references/gotchas.md#subscriptions--iaps",
      }),
    );
  } else if (sub.state === "READY_TO_SUBMIT") {
    out.push(
      finding({
        id: "subscription.ready-to-submit",
        severity: Severity.INFO,
        category: Category.ASC_STATE,
        title: `${productId} is ready and will be submitted with the version`,
        detail:
          "The app already has an approved subscription, so this one can go by API: submit adds its subscription " +
          "version to the same review submission as the app version.",
        fix: "Nothing; submit includes it.",
        fixCommand: "appstore-release submit --submit",
      }),
    );
  }

  return out;
}
