// App Review contact details, the submission itself, and the one thing Apple has
// never exposed through an API.

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";

export const section = { id: "review", title: "Review and submission" };

const CONTACT_FIELDS = ["contactFirstName", "contactLastName", "contactPhone", "contactEmail"];

/** @param {{ snapshot: any, config: any }} input */
export function check({ snapshot }) {
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

  // App Privacy: every appDataUsages* path 404s. This is not a gap in this tool —
  // it is a gap in Apple's API, and saying so plainly is the point.
  out.push(
    finding({
      id: "privacy.declaration.ui-only",
      severity: Severity.BLOCKER,
      category: Category.ASC_STATE,
      title: "App Privacy data collection must be published by hand",
      detail:
        "Apple keeps the privacy nutrition label UI-only; every appDataUsages endpoint returns 404. " +
        "The version cannot be reviewed until it is published.",
      fixOwner: FixOwner.UI,
      uiOnly: true,
      fix: "Declare the data types matching the app's privacy manifest, then press Publish.",
      fixClicks: ["App Store Connect", "your app", "App Privacy", "Get Started / Edit", "Publish"],
      docs: "references/gotchas.md#app-privacy-ui-only",
    }),
  );

  const state = snapshot.version.attributes.appStoreState;
  if (["REJECTED", "METADATA_REJECTED"].includes(state)) {
    out.push(
      finding({
        id: "submission.rejected",
        category: Category.ASC_STATE,
        title: `Apple rejected this version (${state})`,
        detail:
          "The version is editable again. The rejection text itself lives in Resolution Center, " +
          "which Apple does not expose through the API.",
        fixOwner: FixOwner.UI,
        uiOnly: true,
        fix: "Read the Resolution Center message, fix what it names, then resubmit.",
        fixClicks: ["App Store Connect", "your app", "App Review", "Resolution Center"],
      }),
    );
  }

  if (["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE"].includes(state)) {
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
