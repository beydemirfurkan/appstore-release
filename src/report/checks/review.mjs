// App Review contact details, the submission itself, and the one thing Apple has
// never exposed through an API.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";

export const section = { id: "review", title: "Review and submission" };

const CONTACT_FIELDS = ["contactFirstName", "contactLastName", "contactPhone", "contactEmail"];
const SUBMITTED_STATES = ["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "READY_FOR_SALE"];

/**
 * App Privacy: every appDataUsages* path 404s. This is not a gap in this tool —
 * it is a gap in Apple's API, and saying so plainly is the point.
 *
 * Because nothing can read the label back, the only way past this finding is the
 * user saying it is done: `review.privacyPublished: true`. That turns the blocker
 * into a reminder rather than pretending we verified it — `uiOnly` stays true
 * either way, because who can fix it has not changed.
 *
 * @param {any} config
 */
function privacyFinding(config) {
  const attested = config?.review?.privacyPublished === true;
  return finding({
    id: "privacy.declaration.ui-only",
    severity: attested ? Severity.INFO : Severity.BLOCKER,
    category: Category.ASC_STATE,
    title: attested
      ? "App Privacy marked as published in the config (the API cannot confirm it)"
      : "App Privacy data collection must be published by hand",
    detail: attested
      ? "review.privacyPublished is true. Apple keeps the privacy label UI-only, so this is taken on trust; " +
        "if it is not actually published, App Store Connect will refuse the submission."
      : "Apple keeps the privacy nutrition label UI-only; every appDataUsages endpoint returns 404. " +
        "The version cannot be reviewed until it is published. Once it is, set review.privacyPublished to true.",
    fixOwner: FixOwner.UI,
    uiOnly: true,
    fix: attested
      ? "Nothing, if the label is published."
      : 'Declare the data types matching the app\'s privacy manifest, press Publish, then set "review": { "privacyPublished": true }.',
    fixClicks: ["App Store Connect", "your app", "App Privacy", "Get Started / Edit", "Publish"],
    docs: "references/gotchas.md#app-privacy-ui-only",
  });
}

/** @param {{ snapshot: any, config: any }} input */
export function check({ snapshot, config }) {
  const out = [];
  if (!snapshot.version) return out;

  const detail = snapshot.reviewDetail;
  const missing = CONTACT_FIELDS.filter((f) => !detail?.attributes?.[f]);
  if (missing.length) {
    out.push(
      finding({
        id: "review.contact.missing",
        category: Category.ASC_STATE,
        title: "App Review contact details are incomplete",
        detail: `Missing: ${missing.join(", ")}. Apple requires all four.`,
        fix: "Fill review.* in your config and write the review details.",
        fixCommand: "appstore-release review-info",
      }),
    );
  }

  if (detail?.attributes?.demoAccountRequired && !detail.attributes.demoAccountName) {
    out.push(
      finding({
        id: "review.demo.required-but-empty",
        category: Category.ASC_STATE,
        title: "A demo account is required but not provided",
        detail: "demoAccountRequired is true with no credentials, which reviewers reject immediately.",
        fix: "Set review.demoAccountName and review.demoAccountPassword, or set demoAccountRequired to false.",
        fixCommand: "appstore-release review-info",
      }),
    );
  }

  const state = snapshot.version.attributes.appStoreState;
  if (!SUBMITTED_STATES.includes(state)) out.push(privacyFinding(config));

  if (["REJECTED", "METADATA_REJECTED"].includes(state)) {
    // Everything the API will tell us about the rejection, which is the shape of
    // it and not the substance. Saying that plainly is more useful than implying
    // we could fetch the reviewer's message.
    const unresolved = (snapshot.submission?.items ?? []).filter((i) => i.attributes?.resolved === false);
    const detail = [
      `The version is editable again. ${state === "METADATA_REJECTED" ? "A metadata rejection usually means text or screenshots, not the binary." : "This may be the binary or the listing."}`,
      unresolved.length ? `${unresolved.length} submission item(s) are still unresolved.` : "",
      "The reviewer's message is in Resolution Center, which Apple does not expose through the API — you have to read it.",
    ]
      .filter(Boolean)
      .join(" ");

    out.push(
      finding({
        id: "submission.rejected",
        category: Category.ASC_STATE,
        title: `Apple rejected this version (${state})`,
        detail,
        fixOwner: FixOwner.UI,
        uiOnly: true,
        fix: "Read the Resolution Center message, fix what it names, then run release and submit again.",
        fixClicks: ["App Store Connect", "your app", "App Review", "Resolution Center"],
        evidence: { resource: "appStoreVersions", id: snapshot.version.id, actual: state },
      }),
    );
  }

  // A submission that Apple could not process at all, as distinct from one it
  // reviewed and rejected.
  if (snapshot.submission?.attributes?.state === "UNRESOLVED_ISSUES") {
    out.push(
      finding({
        id: "submission.unresolved-issues",
        category: Category.ASC_STATE,
        title: "The open submission has unresolved issues",
        detail: "App Store Connect will not accept it until they are cleared.",
        fixOwner: FixOwner.UI,
        uiOnly: true,
        fix: "Open the submission in App Store Connect and clear what it lists.",
        fixClicks: ["App Store Connect", "your app", "App Review"],
      }),
    );
  }

  if (state === "PENDING_DEVELOPER_RELEASE") {
    out.push(
      finding({
        id: "submission.approved",
        severity: Severity.INFO,
        category: Category.ASC_STATE,
        title: "Approved — waiting for you to release it",
        detail: "The release type is manual, so the version goes live when you release it.",
        fixOwner: FixOwner.UI,
        fix: "Release it in App Store Connect when you are ready.",
        fixClicks: ["App Store Connect", "your app", "the version", "Release This Version"],
      }),
    );
  } else if (SUBMITTED_STATES.slice(0, 2).includes(state)) {
    out.push(
      finding({
        id: "submission.in-review",
        severity: Severity.INFO,
        category: Category.ASC_STATE,
        title: `Already submitted (${state})`,
        detail: "Nothing to do but wait.",
        fixOwner: FixOwner.EXTERNAL,
        fix: "Wait for Apple.",
      }),
    );
  }

  if (snapshot.submission && !snapshot.submission.attributes?.submitted) {
    out.push(
      finding({
        id: "submission.open-exists",
        severity: Severity.INFO,
        category: Category.ASC_STATE,
        title: "An unsubmitted review submission is already open",
        detail: "Only one submission may be open per app and platform; this one will be reused.",
        fix: "No action needed — submit reuses it.",
      }),
    );
  }

  return out;
}
