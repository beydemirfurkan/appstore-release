// Sets the App Review contact info (and optional demo account) on the version.
// With --draft-notes it writes nothing: it drafts the notes for the reviewer
// from the config and from what preflight reads in the app, for a person to
// check before they go into review.notes.
import { Status } from "../core/status.mjs";
import { runPreflight } from "../preflight/index.mjs";
import { purchaseConfigs, subscriptionConfigs } from "../core/products.mjs";
import { checkRequirements } from "../core/requirements.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "review-info",
  title: "App Review info",
  phase: "listing",
  // Checked in run(): drafting notes needs no contact details, writing them does.
  needs: [],
  mutates: true,
  args: {
    draftNotes: {
      type: "boolean",
      default: false,
      description: "draft the notes for App Review from the config and the app; writes nothing",
    },
  },
};

/** @param {import("../core/context.mjs").Context} ctx @param {{ draftNotes?: boolean }} [args] */
export async function run(ctx, args = {}) {
  const { client, discovery, config } = ctx;

  if (args.draftNotes) {
    const { signals } = runPreflight({ projectDir: ctx.projectRoot, config });
    const notes = draftReviewNotes(config, signals);
    for (const line of notes.split("\n")) ctx.log.info(line);
    return {
      status: Status.OK,
      message: "drafted the App Review notes — nothing written; review them, then put them in review.notes",
      details: { notes },
    };
  }

  const missing = checkRequirements(config, ["review"]);
  if (missing.length) {
    return { status: Status.ERROR, message: missing.map((f) => f.title).join("; "), findings: missing };
  }
  const r = config.review;

  const version = await discovery.editableVersion();
  const attributes = {
    contactFirstName: r.contactFirstName,
    contactLastName: r.contactLastName,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    demoAccountRequired: !!r.demoAccountRequired,
    demoAccountName: r.demoAccountName || "",
    demoAccountPassword: r.demoAccountPassword || "",
    notes: r.notes || "",
  };

  const existing = await client.get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`, { throwOnError: false });
  const label = `${r.contactFirstName} ${r.contactLastName}`;
  if (!existing.error && existing.data) {
    // Only what differs is sent, so an unchanged config is a true no-op. Apple
    // returns null for an empty string, hence the normalisation.
    const current = existing.data.attributes ?? {};
    const diff = Object.fromEntries(
      Object.entries(attributes).filter(([k, v]) => (current[k] ?? (typeof v === "boolean" ? false : "")) !== v),
    );
    if (!Object.keys(diff).length) return { status: Status.OK, message: label };
    await client.patch(`/v1/appStoreReviewDetails/${existing.data.id}`, {
      data: { type: "appStoreReviewDetails", id: existing.data.id, attributes: diff },
    });
  } else {
    await client.post(`/v1/appStoreReviewDetails`, {
      data: {
        type: "appStoreReviewDetails",
        attributes,
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
      },
    });
  }
  return { status: Status.CHANGED, message: label };
}

/** "NSPhotoLibraryUsageDescription" → "Photo Library". @param {string} key */
const permissionName = (key) =>
  key
    .replace(/^NS/, "")
    .replace(/UsageDescription$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

/**
 * Plain text for App Review, in the sections reviewers look for. What cannot
 * be known from the project is left as an instruction in parentheses, for the
 * person to replace: a guessed path to a feature is worse than none.
 *
 * @param {any} config
 * @param {import("../preflight/index.mjs").PreflightSignals} signals
 * @returns {string}
 */
export function draftReviewNotes(config, signals) {
  const r = config?.review ?? {};
  /** @type {Array<[string, string[]]>} */
  const sections = [];

  const signIn = [];
  if (r.demoAccountName) {
    signIn.push(`Demo account: ${r.demoAccountName} (the password is in the App Review sign-in fields).`);
  } else if (signals.signIn) {
    signIn.push("(The app has sign-in: add a demo account — review.demoAccountName and review.demoAccountPassword.)");
  } else {
    signIn.push("No sign-in is needed: every feature is available without an account.");
  }
  if (signals.logins.length) signIn.push(`Sign-in options: ${signals.logins.join(", ")}.`);
  sections.push(["Sign-in", signIn]);

  sections.push([
    "How to reach key features",
    ["(Two or three steps from launch to the main feature, in the app's own words.)"],
  ]);

  if (signals.permissions.length) {
    sections.push(["Permissions", signals.permissions.map(({ key, text }) => `${permissionName(key)}: "${text}"`)]);
  }

  const products = [
    ...subscriptionConfigs(config).map((p) => {
      const price = p.priceAmount != null ? `, ${p.priceAmount} (${p.priceTerritory})` : "";
      return `${p.name ?? p.productId} — ${p.productId}, auto-renewing${p.period ? ` ${p.period.toLowerCase().replace(/_/g, " ")}` : ""}${price}`;
    }),
    ...purchaseConfigs(config).map((p) => {
      const price = p.priceAmount != null ? `, ${p.priceAmount} (${p.priceTerritory})` : "";
      return `${p.name ?? p.productId} — ${p.productId}, ${String(p.type).toLowerCase().replace(/_/g, "-")}${price}`;
    }),
  ];
  if (products.length || signals.purchases) {
    sections.push([
      "In-app purchases",
      [
        ...products,
        "Purchases can be tested with a Sandbox account; Restore Purchases is on the paywall (say where if not).",
      ],
    ]);
  }

  if (r.notes) sections.push(["Notes", [r.notes]]);

  return sections.map(([title, lines]) => [title, ...lines.map((l) => `- ${l}`)].join("\n")).join("\n\n");
}
