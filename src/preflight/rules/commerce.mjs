// Selling: 3.1.1 (digital goods use In-App Purchase) and 3.1.2 (subscriptions:
// "a way for current subscribers to sign in or restore purchases").

import { EXTERNAL_PAYMENT_PACKAGES, IAP_PACKAGES } from "../data.mjs";
import { appFinding, hasAny, Severity } from "./util.mjs";

/**
 * @param {import("../project.mjs").Project} project
 * @param {{ sellsProducts?: boolean }} [context]  the config describes subscriptions or in-app purchases
 */
export function commerce(project, { sellsProducts = false } = {}) {
  const out = [];
  const external = EXTERNAL_PAYMENT_PACKAGES.filter((p) => project.deps.has(p));
  const iap = hasAny(project, IAP_PACKAGES);
  if (external.length && !iap) {
    out.push(
      appFinding({
        id: "app.payments.external",
        guideline: "3.1.1",
        severity: Severity.WARNING,
        title: `${external.join(", ")} without In-App Purchase`,
        detail:
          "Unlocking features or content inside the app must use In-App Purchase. External payment is fine for physical goods and services used outside the app.",
        fix: "If anything paid is digital (premium features, content, credits), sell it with In-App Purchase; otherwise say in the review notes what is being paid for.",
      }),
    );
  }

  if ((sellsProducts || iap) && project.sources.length && !project.sources.some((s) => /restore/i.test(s.text))) {
    out.push(
      appFinding({
        id: "app.subscription.restore",
        guideline: "3.1.2",
        severity: Severity.WARNING,
        title: "Purchases are sold, but nothing in the code restores them",
        detail: 'The subscription screen needs "a way for current subscribers to sign in or restore purchases".',
        fix: "Add a Restore Purchases button (RevenueCat: restorePurchases(); StoreKit: AppStore.sync()).",
      }),
    );
  }
  return out;
}
