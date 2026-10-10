// Apple's rule for a FIRST subscription, in one place.
//
// "Submit your first subscription together with an app binary submission
// through appstoreconnect.apple.com. For subsequent subscriptions, submit using
// the API endpoints." — Submitting subscriptions and subscription groups for App
// Review (App Store Connect API docs, 4.4.1+). Versioned review items made later
// subscriptions submittable by API; they did not change this.

/** States a subscription only reaches after Apple has approved it once. */
const SHIPPED_STATES = ["APPROVED", "DEVELOPER_REMOVED_FROM_SALE", "REMOVED_FROM_SALE"];

/**
 * True when the app has never had a subscription approved — so the one being
 * prepared is its first, and goes to review from the web UI with the binary.
 *
 * @param {Array<{ state?: string, attributes?: { state?: string } }>} subscriptions  every subscription of the app
 */
export function isFirstSubscription(subscriptions) {
  return !subscriptions.some((s) => SHIPPED_STATES.includes(s.state ?? s.attributes?.state ?? ""));
}
