// What the app sells: every configured subscription and in-app purchase —
// whether it exists, whether it is complete, and how it reaches review.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";
import { FIRST_PRODUCT_CLICKS, isFirstProduct, purchaseConfigs, subscriptionConfigs } from "../../core/products.mjs";
import { resolveLocales } from "../../core/locales.mjs";

export const section = { id: "subscription", title: "Purchases" };

/** Apple's standard EULA, which any listing may link to instead of its own terms. */
const STANDARD_EULA = "apple.com/legal/internet-services/itunes/dev/stdeula";
/** "Terms of Use" and its usual names, in the languages listings are most often written in. */
const TERMS_RE =
  /terms of (use|service)|\bEULA\b|nutzungsbedingungen|conditions (générales )?d['’]utilisation|términos (de uso|y condiciones)|termini (d['’]uso|di servizio)|termos de uso|kullanım koşulları|gebruiksvoorwaarden|利用規約|使用条款|服務條款|이용약관/i;

/** @param {unknown} text */
const hasTermsLink = (text) =>
  typeof text === "string" && (text.includes(STANDARD_EULA) || (TERMS_RE.test(text) && /https?:\/\//.test(text)));

/**
 * Guideline 3.1.2: an auto-renewing subscription's "metadata must include links
 * to your Terms of Use and Privacy Policy". The privacy policy URL is a required
 * field already; the terms link is either a custom EULA in App Store Connect or a
 * link in the description.
 *
 * @param {any} snapshot @param {any} config
 */
function termsLinkFinding(snapshot, config) {
  if (!subscriptionConfigs(config).length && !snapshot.subscriptions?.length) return [];
  // Unknown is not missing: say nothing rather than guess.
  if (!snapshot.eula || snapshot.eula.custom) return [];
  const fromConfig = resolveLocales(config ?? {}).map(({ locale, metadata }) => ({
    locale,
    text: metadata.description,
  }));
  const listings = fromConfig.length
    ? fromConfig
    : (snapshot.localizations ?? [])
        .filter((/** @type {any} */ l) => l.detailed)
        .map((/** @type {any} */ l) => ({ locale: l.attributes?.locale, text: l.attributes?.description }));
  const without = listings.filter((l) => !hasTermsLink(l.text)).map((l) => l.locale);
  if (!without.length) return [];
  return [
    finding({
      id: "subscription.terms-link.missing",
      severity: Severity.WARNING,
      category: Category.CONFIG,
      title: "No Terms of Use link for the subscription",
      detail:
        `Guideline 3.1.2: a subscription's metadata must link to the Terms of Use (EULA) and the privacy policy. ` +
        `There is no custom EULA in App Store Connect, and the description has no terms link` +
        `${listings.length > 1 ? ` in: ${without.join(", ")}` : ""}.`,
      fixOwner: FixOwner.CLI,
      fix:
        `Add a line to the description, e.g. "Terms of Use: https://www.${STANDARD_EULA}/", then run metadata — ` +
        "or set a custom EULA in App Store Connect (App Information → License Agreement).",
      fixCommand: "appstore-release metadata",
      guideline: "3.1.2",
      docs: "references/gotchas.md#subscriptions--iaps",
    }),
  ];
}

/** @param {{ snapshot: any, config: any }} input */
export function check({ snapshot, config }) {
  const out = [...termsLinkFinding(snapshot, config)];
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
    // An app's first subscription — and first in-app purchase — goes to review
    // with an app version. submit sends it by API in the same submission.
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
            id: `${k.kind}.first.with-version${suffix}`,
            severity: Severity.INFO,
            category: Category.ASC_STATE,
            title: `${productId} is the app's first ${k.label.toLowerCase()}; it goes to review with the version`,
            detail:
              `submit adds it to the same review submission as the app version. If App Store Connect will not take ` +
              "a first product by API, nothing is submitted, it is taken back out, and the website's clicks are shown.",
            fix: "Nothing; submit includes it. To send the app alone: submit --submit --skip-products.",
            fixCommand: "appstore-release submit --submit",
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
