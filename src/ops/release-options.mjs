// When and how the approved version reaches the store.
//
// `review.releaseType` sat in the config template from the beginning and was
// read by absolutely nothing — a documented setting that silently did nothing,
// which is worse than an undocumented one. It now works, and release timing
// lives in its own block, because it is not review information.

import { Status } from "../core/status.mjs";
import { finding, Severity, Category, FixOwner } from "../core/findings.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "release-options",
  title: "Release timing",
  phase: "listing",
  needs: [],
  mutates: true,
};

/**
 * Release timing, from the current block or the deprecated `review.releaseType`.
 * @param {object|null} config
 */
export function resolveRelease(config) {
  const block = config?.release ?? {};
  const type = block.type ?? config?.review?.releaseType ?? null;
  if (!type && block.phased == null) return null;
  return {
    type,
    earliestDate: block.earliestDate ?? null,
    phased: block.phased ?? false,
    legacy: !block.type && Boolean(config?.review?.releaseType),
  };
}

/** @param {import("../core/context.mjs").Context} ctx */
export async function run({ client, discovery, config }) {
  const wanted = resolveRelease(config);
  if (!wanted) return { status: Status.SKIPPED, message: "no release timing configured" };

  const version = await discovery.editableVersion();
  const changes = [];
  const findings = [];

  if (wanted.legacy) {
    findings.push(
      finding({
        id: "config.review.releaseType.deprecated",
        severity: Severity.WARNING,
        category: Category.CONFIG,
        title: "config.review.releaseType is deprecated",
        detail: "Release timing is not review information; it now lives in its own block.",
        fixOwner: FixOwner.CLI,
        fix: `Move it to "release": { "type": "${wanted.type}" }. The old key still works for now.`,
      }),
    );
  }

  if (wanted.type) {
    const current = (
      await client.get(`/v1/appStoreVersions/${version.id}?fields[appStoreVersions]=releaseType,earliestReleaseDate`)
    ).data;

    if (wanted.type === "SCHEDULED" && !wanted.earliestDate) {
      return {
        status: Status.ERROR,
        message: "release.type is SCHEDULED but release.earliestDate is not set",
        findings,
      };
    }

    const attributes = {};
    if (current.attributes.releaseType !== wanted.type) attributes.releaseType = wanted.type;
    if (wanted.type === "SCHEDULED" && current.attributes.earliestReleaseDate !== wanted.earliestDate) {
      attributes.earliestReleaseDate = wanted.earliestDate;
    }

    if (Object.keys(attributes).length) {
      await client.patch(`/v1/appStoreVersions/${version.id}`, {
        data: { type: "appStoreVersions", id: version.id, attributes },
      });
      changes.push(`release ${wanted.type}`);
    }
  }

  // Phased release is a separate resource: present means on, absent means off.
  const existing = await client.get(`/v1/appStoreVersions/${version.id}/appStoreVersionPhasedRelease`, {
    throwOnError: false,
  });
  const hasPhased = !existing.error && Boolean(existing.data);

  if (wanted.phased && !hasPhased) {
    await client.post(`/v1/appStoreVersionPhasedReleases`, {
      data: {
        type: "appStoreVersionPhasedReleases",
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
      },
    });
    changes.push("phased release on");
  } else if (!wanted.phased && hasPhased) {
    await client.delete(`/v1/appStoreVersionPhasedReleases/${existing.data.id}`, { throwOnError: false });
    changes.push("phased release off");
  }

  if (!changes.length) return { status: Status.OK, message: "release timing already set", findings };
  return { status: Status.CHANGED, message: changes.join(", "), findings, details: { ...wanted } };
}
