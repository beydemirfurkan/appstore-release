// Open the next App Store version.
//
// Without this there was no way out of "no editable version": the snapshot
// correctly refuses to target a live version, and then nothing could create one.
// Every update needs this before any listing work can start.

import { Status } from "../core/status.mjs";
import { EDITABLE_STATES } from "../report/snapshot.mjs";
import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "new-version",
  title: "New version",
  phase: "listing",
  needs: [],
  mutates: true,
  args: {
    version: {
      type: "string",
      description: "the version string to create, e.g. 1.2.0",
    },
    platform: {
      type: "string",
      default: "IOS",
      description: "IOS, MAC_OS or TV_OS",
    },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ version?: string, platform?: string }} [args]
 */
export async function run({ client, discovery, config }, args = {}) {
  const versions = await client.all(
    `/v1/apps/${discovery.appId}/appStoreVersions?fields[appStoreVersions]=versionString,appStoreState,platform`,
    { limit: 50 },
  );

  const editable = versions.find((v) => EDITABLE_STATES.has(v.attributes.appStoreState));
  if (editable) {
    return {
      status: Status.OK,
      message: `v${editable.attributes.versionString} is already open for editing (${editable.attributes.appStoreState})`,
      details: { versionId: editable.id, versionString: editable.attributes.versionString, created: false },
    };
  }

  const versionString = args.version ?? nextVersion(versions);
  if (!versionString) {
    return {
      status: Status.ERROR,
      message: "no version number given and none could be inferred",
      findings: [
        finding({
          id: "version.new.no-number",
          severity: Severity.BLOCKER,
          category: Category.CONFIG,
          title: "No version number to create",
          detail: "This app has no existing version to increment from.",
          fixOwner: FixOwner.CLI,
          fix: "Pass the version explicitly: appstore-release new-version 1.0",
        }),
      ],
    };
  }

  if (versions.some((v) => v.attributes.versionString === versionString)) {
    return {
      status: Status.ERROR,
      message: `v${versionString} already exists and is not editable`,
    };
  }

  const created = (
    await client.post(`/v1/appStoreVersions`, {
      data: {
        type: "appStoreVersions",
        attributes: {
          versionString,
          platform: args.platform ?? "IOS",
          ...(config?.review?.releaseType ? { releaseType: config.review.releaseType } : {}),
        },
        relationships: { app: { data: { type: "apps", id: discovery.appId } } },
      },
    })
  ).data;

  return {
    status: Status.CHANGED,
    message: `created v${versionString}`,
    details: { versionId: created.id, versionString, created: true },
  };
}

/** Bump the last numeric component of the newest version we can see. */
function nextVersion(versions) {
  const parsed = versions
    .map((v) => String(v.attributes.versionString ?? ""))
    .filter((s) => /^\d+(\.\d+)*$/.test(s))
    .map((s) => s.split(".").map(Number))
    .sort(compareParts);
  const newest = parsed.at(-1);
  if (!newest) return null;
  const next = [...newest];
  next[next.length - 1] += 1;
  return next.join(".");
}

function compareParts(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
