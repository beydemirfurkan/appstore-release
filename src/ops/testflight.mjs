// TestFlight: put a build in front of testers. Separate from the listing
// pipeline on purpose — who tests what, and when, is its own decision.
//
// In order, each step writing only what differs:
//   1. the build: newest VALID one for the editable version, or --build
//   2. export compliance, when the build still asks (usesNonExemptEncryption)
//   3. "What to Test", per locale
//   4. for external testing: the beta app description and feedback email, and
//      the beta review contact (from `review`)
//   5. groups — created when missing — and the build added to each
//   6. testers, invited by email into their group
//   7. beta app review, when an external group has the build and it has not
//      been submitted yet
import { Status } from "../core/status.mjs";
import { upsertLocalization } from "./subscription.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "testflight",
  title: "TestFlight",
  phase: "build",
  needs: [],
  mutates: true,
  args: {
    build: { type: "string", description: "use this build number instead of the newest VALID one" },
  },
};

/** External build states past the point of submitting for beta review. */
const BETA_SUBMITTED = [
  "WAITING_FOR_BETA_REVIEW",
  "IN_BETA_REVIEW",
  "BETA_APPROVED",
  "IN_BETA_TESTING",
  "READY_FOR_BETA_TESTING",
];

/**
 * @typedef {Object} TestFlightConfig
 * @property {string | Record<string, string>} [whatToTest]
 * @property {Array<string | { name: string, internal?: boolean, publicLink?: boolean }>} [groups]
 * @property {Array<{ email: string, group: string, firstName?: string, lastName?: string }>} [testers]
 * @property {string} [description]      beta app description (external testing)
 * @property {string} [feedbackEmail]
 * @property {boolean} [usesNonExemptEncryption]
 * @property {boolean} [submitForReview] default true when an external group is configured
 */

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ build?: string }} [args]
 */
export async function run(ctx, args = {}) {
  const { client, discovery, config } = ctx;
  /** @type {TestFlightConfig} */
  const tf = config?.testflight ?? {};
  if (!config?.testflight) return { status: Status.SKIPPED, message: "no testflight block in the config" };
  const changes = [];

  // 1. The build.
  let build;
  if (args.build) build = await discovery.latestBuild(args.build);
  else {
    const version = await discovery.editableVersion().catch(() => null);
    build = await discovery.latestValidBuild(version?.attributes?.versionString);
  }
  if (!build) return { status: Status.ERROR, message: "no VALID build to test — upload one first" };
  const label = `build ${build.attributes.version}`;

  // 2. Export compliance: a build waits in MISSING_EXPORT_COMPLIANCE until it is answered.
  const full = (await client.get(`/v1/builds/${build.id}?fields[builds]=version,usesNonExemptEncryption`)).data;
  if (full.attributes?.usesNonExemptEncryption == null) {
    if (tf.usesNonExemptEncryption == null) {
      return {
        status: Status.ERROR,
        message:
          `${label} needs an export compliance answer: set testflight.usesNonExemptEncryption ` +
          "(or ITSAppUsesNonExemptEncryption in Info.plist — for Expo, ios.config.usesNonExemptEncryption)",
      };
    }
    await client.patch(`/v1/builds/${build.id}`, {
      data: { type: "builds", id: build.id, attributes: { usesNonExemptEncryption: tf.usesNonExemptEncryption } },
    });
    changes.push("export compliance");
  }

  // 3. What to Test.
  const notes = typeof tf.whatToTest === "string" ? { [config.locale]: tf.whatToTest } : (tf.whatToTest ?? {});
  if (Object.keys(notes).length) {
    const existing = await client.all(`/v1/betaBuildLocalizations?filter[build]=${build.id}`, { limit: 50 });
    for (const [locale, whatsNew] of Object.entries(notes)) {
      const res = await upsertLocalization(
        client,
        existing,
        locale,
        { whatsNew },
        { type: "betaBuildLocalizations", relationships: { build: { data: { type: "builds", id: build.id } } } },
      );
      if (res) changes.push("what to test");
    }
  }

  // 5 (resolved early: whether anything is external decides step 4).
  const wanted = (tf.groups ?? []).map((g) => (typeof g === "string" ? { name: g, internal: false } : g));
  const external = wanted.some((g) => !g.internal);

  // 4. What external testing needs before beta review.
  if (external) {
    if (tf.description || tf.feedbackEmail) {
      const locs = await client.all(`/v1/betaAppLocalizations?filter[app]=${discovery.appId}`, { limit: 50 });
      const res = await upsertLocalization(
        client,
        locs,
        config.locale,
        { description: tf.description, feedbackEmail: tf.feedbackEmail },
        { type: "betaAppLocalizations", relationships: { app: { data: { type: "apps", id: discovery.appId } } } },
      );
      if (res) changes.push("beta description");
    }
    const r = config?.review ?? {};
    const contact = {
      contactFirstName: r.contactFirstName,
      contactLastName: r.contactLastName,
      contactPhone: r.contactPhone,
      contactEmail: r.contactEmail,
      demoAccountRequired: Boolean(r.demoAccountRequired),
      demoAccountName: r.demoAccountName ?? "",
      demoAccountPassword: r.demoAccountPassword ?? "",
      notes: r.notes ?? "",
    };
    if (contact.contactEmail) {
      const current = await client.get(`/v1/apps/${discovery.appId}/betaAppReviewDetail`, { throwOnError: false });
      const id = current.data?.id ?? discovery.appId;
      const now = current.data?.attributes ?? {};
      const diff = Object.fromEntries(
        Object.entries(contact).filter(
          ([k, v]) => v !== undefined && (now[k] ?? (typeof v === "boolean" ? false : "")) !== v,
        ),
      );
      if (Object.keys(diff).length) {
        await client.patch(`/v1/betaAppReviewDetails/${id}`, {
          data: { type: "betaAppReviewDetails", id, attributes: diff },
        });
        changes.push("beta review contact");
      }
    }
  }

  // 5. Groups, and the build in each.
  const groups = await client.all(`/v1/apps/${discovery.appId}/betaGroups`, { limit: 200 });
  /** @type {Map<string, any>} */
  const byName = new Map(groups.map((g) => [g.attributes.name, g]));
  for (const g of wanted) {
    let group = byName.get(g.name);
    if (!group) {
      group = (
        await client.post(`/v1/betaGroups`, {
          data: {
            type: "betaGroups",
            attributes: {
              name: g.name,
              isInternalGroup: Boolean(g.internal),
              ...(g.publicLink && !g.internal ? { publicLinkEnabled: true } : {}),
            },
            relationships: { app: { data: { type: "apps", id: discovery.appId } } },
          },
        })
      ).data;
      byName.set(g.name, group);
      changes.push(`group ${g.name} created`);
    }
    const builds = String(group.id).startsWith("dry:")
      ? []
      : await client.all(`/v1/betaGroups/${group.id}/relationships/builds`, { limit: 200 });
    if (!builds.some((b) => b.id === build.id)) {
      await client.post(`/v1/betaGroups/${group.id}/relationships/builds`, {
        data: [{ type: "builds", id: build.id }],
      });
      changes.push(`→ ${g.name}`);
    }
  }

  // 6. Testers.
  for (const t of tf.testers ?? []) {
    const group = byName.get(t.group);
    if (!group) {
      return {
        status: Status.ERROR,
        message: `tester ${t.email} names group "${t.group}", which is not in testflight.groups`,
      };
    }
    const found = await client.get(
      `/v1/betaTesters?filter[email]=${encodeURIComponent(t.email)}&filter[apps]=${discovery.appId}&include=betaGroups&limit=1`,
    );
    const tester = found.data?.[0];
    if (!tester) {
      await client.post(`/v1/betaTesters`, {
        data: {
          type: "betaTesters",
          attributes: {
            email: t.email,
            ...(t.firstName ? { firstName: t.firstName } : {}),
            ...(t.lastName ? { lastName: t.lastName } : {}),
          },
          relationships: { betaGroups: { data: [{ type: "betaGroups", id: group.id }] } },
        },
      });
      changes.push(`invited ${t.email}`);
    } else if (!(tester.relationships?.betaGroups?.data ?? []).some((/** @type {any} */ d) => d.id === group.id)) {
      await client.post(`/v1/betaGroups/${group.id}/relationships/betaTesters`, {
        data: [{ type: "betaTesters", id: tester.id }],
      });
      changes.push(`${t.email} → ${t.group}`);
    }
  }

  // 7. Beta app review, for external testing.
  if (external && tf.submitForReview !== false) {
    const detail = await client.get(`/v1/builds/${build.id}/buildBetaDetail`, { throwOnError: false });
    const state = detail.data?.attributes?.externalBuildState;
    if (!BETA_SUBMITTED.includes(state)) {
      await client.post(`/v1/betaAppReviewSubmissions`, {
        data: {
          type: "betaAppReviewSubmissions",
          relationships: { build: { data: { type: "builds", id: build.id } } },
        },
      });
      changes.push("sent to beta review");
    }
  }

  if (!changes.length) return { status: Status.OK, message: `${label} already with its testers` };
  return {
    status: Status.CHANGED,
    message: `${label} · ${changes.join(" · ")}`,
    details: { buildId: build.id, changes },
  };
}
