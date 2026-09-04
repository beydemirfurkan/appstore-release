// Is there a version we may edit, and does it have a build?

import { finding, Severity, Category, FixOwner } from "../../core/findings.mjs";

export const section = { id: "version", title: "Version and build" };

/** @param {{ snapshot: any, config: any }} input */
export function check({ snapshot }) {
  const out = [];
  const { version, versions, build, latestBuilds } = snapshot;

  if (!version) {
    const live = versions?.[0];
    out.push(
      finding({
        id: "version.none",
        category: Category.ASC_STATE,
        title: "No editable version",
        detail: live
          ? `The newest version is ${live.attributes.versionString} in state ${live.attributes.appStoreState}, which cannot be edited.`
          : "This app has no App Store version yet.",
        fixOwner: FixOwner.CLI,
        fix: "Open the next version before preparing its listing.",
        fixCommand: "appstore-release new-version",
      }),
    );
    return out; // nothing below can be judged without a version
  }

  if (!version.attributes.copyright) {
    out.push(
      finding({
        id: "version.copyright.missing",
        category: Category.ASC_STATE,
        title: "No copyright",
        detail: "App Store Connect refuses 'Add for Review' without one.",
        fix: "Set metadata.copyright in your config, then run the pricing operation.",
        fixCommand: "appstore-release pricing",
        docs: "references/gotchas.md#pricing--availability",
      }),
    );
  }

  if (!build) {
    const valid = (latestBuilds ?? []).find((b) => b.attributes.processingState === "VALID" && !b.attributes.expired);
    const processing = (latestBuilds ?? []).find((b) => b.attributes.processingState === "PROCESSING");
    if (valid) {
      out.push(
        finding({
          id: "version.build.missing",
          category: Category.ASC_STATE,
          title: "No build attached",
          detail: `Build ${valid.attributes.version} is VALID and ready to attach.`,
          fix: "Attach the newest valid build.",
          fixCommand: "appstore-release attach-build",
          evidence: { resource: "builds", id: valid.id },
        }),
      );
    } else if (processing) {
      out.push(
        finding({
          id: "version.build.processing",
          severity: Severity.WARNING,
          category: Category.BINARY,
          title: "The build is still processing",
          detail: `Build ${processing.attributes.version} is PROCESSING. It cannot be attached until Apple finishes.`,
          fixOwner: FixOwner.EXTERNAL,
          fix: "Wait for processing to finish, then run attach-build.",
        }),
      );
    } else {
      out.push(
        finding({
          id: "version.build.none",
          category: Category.BINARY,
          title: "No build has been uploaded",
          detail: "There is no VALID build for this app.",
          fixOwner: FixOwner.EXTERNAL,
          fix: "Build and upload the binary (for Expo: eas build -p ios && eas submit -p ios).",
        }),
      );
    }
  } else if (build.attributes?.expired) {
    out.push(
      finding({
        id: "version.build.expired",
        category: Category.BINARY,
        title: "The attached build has expired",
        detail: `Build ${build.attributes.version} is expired and cannot be reviewed.`,
        fixOwner: FixOwner.EXTERNAL,
        fix: "Upload a new build, then run attach-build.",
      }),
    );
  }

  return out;
}
