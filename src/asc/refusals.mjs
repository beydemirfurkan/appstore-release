// When App Store Connect refuses a submission it says why, in sentences, often
// nested a level down under `meta.associatedErrors`. This turns the sentences
// it is known to use into findings that say what to run or where to click, and
// keeps every sentence it does not recognise word for word: nothing Apple says
// is dropped.

import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";

/** The App Privacy steps, also used by the readiness report. */
export const APP_PRIVACY_CLICKS = ["App Store Connect", "your app", "App Privacy", "Get Started / Edit", "Publish"];

/**
 * Known refusals. Patterns follow the wording Apple uses in `errors[].detail`
 * (and in `meta.associatedErrors`) when finalising a review submission.
 *
 * @type {Array<{ id: string, pattern: RegExp, title: string, fix: string, fixCommand?: string, fixClicks?: string[] }>}
 */
export const REFUSALS = [
  {
    id: "refusal.screenshots",
    pattern: /screenshot/i,
    title: "Screenshots are missing for a required size",
    fix: "Upload screenshots for every required display size.",
    fixCommand: "appstore-release screenshots",
  },
  {
    id: "refusal.content-rights",
    pattern: /contentRightsDeclaration|content rights/i,
    title: "The content rights declaration is not set",
    fix: "Set contentRights in the config.",
    fixCommand: "appstore-release content-rights",
  },
  {
    id: "refusal.app-privacy",
    pattern: /data usages|app privacy|privacy (nutrition )?label/i,
    title: "App Privacy is not published",
    fix: "Publish the App Privacy answers in App Store Connect, then submit again.",
    fixClicks: APP_PRIVACY_CLICKS,
  },
  {
    id: "refusal.pricing",
    pattern: /pricing has been set|price (has not been|is not) set|no price/i,
    title: "No price is set",
    fix: "Set price in the config.",
    fixCommand: "appstore-release pricing",
  },
  {
    id: "refusal.age-rating",
    pattern: /age rating|ageRatingDeclaration/i,
    title: "The age rating is incomplete",
    fix: "Complete ageRating in the config.",
    fixCommand: "appstore-release age-rating",
  },
  {
    id: "refusal.build",
    pattern: /(select|attach|choose|add) a build|no build|build is (missing|required)/i,
    title: "No build is attached",
    fix: "Attach the processed build.",
    fixCommand: "appstore-release attach-build",
  },
  {
    id: "refusal.whats-new",
    pattern: /whatsNew|what['’]s new/i,
    title: "What's New is missing",
    fix: "Set metadata.whatsNew in every locale.",
    fixCommand: "appstore-release metadata",
  },
  {
    id: "refusal.review-contact",
    pattern: /contact (information|first name|last name|phone|email)|appStoreReviewDetail/i,
    title: "App Review contact details are missing",
    fix: "Fill in review.contact* in the config.",
    fixCommand: "appstore-release review-info",
  },
];

/** A sentence about a subscription or an in-app purchase rather than the app. */
const PRODUCT_RE = /subscription|in-app purchase|inAppPurchase|in app purchase/i;

/**
 * Every sentence in an Apple error, the nested ones included.
 *
 * @param {{ errors?: any[] } | null | undefined} error  an AscApiError, or anything with `errors`
 * @returns {string[]}
 */
export function refusalLines(error) {
  /** @type {string[]} */
  const out = [];
  const visit = (/** @type {any} */ e) => {
    const nested = Object.values(e?.meta?.associatedErrors ?? {}).flat();
    // With reasons underneath, the top line is only "cannot be submitted": the
    // reasons are what is worth reading.
    if (nested.length) {
      for (const n of nested) visit(n);
      return;
    }
    const text = e?.detail || e?.title;
    if (text && !out.includes(text)) out.push(text);
  };
  for (const e of error?.errors ?? []) visit(e);
  return out;
}

/**
 * @param {{ errors?: any[] } | null | undefined} error
 * @returns {{ lines: string[], findings: import("../core/findings.mjs").Finding[], productRelated: boolean }}
 */
export function explainRefusal(error) {
  const lines = refusalLines(error);
  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = [];
  for (const line of lines) {
    // A product's own refusal ("…subscription review screenshot…") is not the
    // app's: it is reported as said, not mapped to an app command.
    const known = PRODUCT_RE.test(line) ? undefined : REFUSALS.find((r) => r.pattern.test(line));
    if (known && findings.some((f) => f.id === known.id)) continue;
    findings.push(
      known
        ? finding({
            id: known.id,
            category: Category.ASC_STATE,
            title: known.title,
            detail: `App Store Connect: "${line}"`,
            fix: known.fix,
            ...(known.fixCommand ? { fixCommand: known.fixCommand } : {}),
            ...(known.fixClicks
              ? { fixOwner: FixOwner.UI, uiOnly: true, fixClicks: known.fixClicks }
              : { fixOwner: FixOwner.CLI }),
          })
        : finding({
            id: `refusal.unrecognised.${findings.length + 1}`,
            category: Category.ASC_STATE,
            severity: Severity.BLOCKER,
            title: "App Store Connect refused the submission",
            detail: line,
            fixOwner: FixOwner.EXTERNAL,
            fix: "Fix what it names, then submit again.",
          }),
    );
  }
  return { lines, findings, productRelated: lines.some((l) => PRODUCT_RE.test(l)) };
}
