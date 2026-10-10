// Attaches the newest VALID build (or a specific one via --build) to the editable version.
import { Status } from "../core/status.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "attach-build",
  title: "Attach build",
  phase: "listing",
  needs: [],
  mutates: true,
  args: {
    build: {
      type: "string",
      description: "attach this build version instead of the newest VALID one",
    },
  },
};

/** @param {import("../core/context.mjs").Context} ctx */
export async function run({ client, discovery }, args = {}) {
  const version = await discovery.editableVersion();
  const versionString = version.attributes.versionString;

  const build = args.build ? await discovery.latestBuild(args.build) : await discovery.latestValidBuild(versionString);
  if (!build) {
    return {
      status: Status.ERROR,
      message: args.build
        ? `build ${args.build} not found`
        : `no VALID build for version ${versionString} — upload one (e.g. \`eas build\` + \`eas submit\`) first`,
    };
  }
  if (build.attributes.processingState && build.attributes.processingState !== "VALID") {
    return {
      status: Status.ERROR,
      message: `build ${build.attributes.version} is ${build.attributes.processingState}, not VALID — wait for processing or pick another`,
    };
  }

  const current = await discovery.attachedBuild(version.id);
  if (current?.id === build.id)
    return { status: Status.OK, message: `build ${build.attributes.version} already attached` };

  await client.patch(`/v1/appStoreVersions/${version.id}/relationships/build`, {
    data: { type: "builds", id: build.id },
  });
  return { status: Status.CHANGED, message: `attached build ${build.attributes.version}` };
}
