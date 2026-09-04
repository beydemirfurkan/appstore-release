// Attaches the newest VALID build (or a specific one via --build) to the editable version.
import { Status } from "../core/log.mjs";

export const meta = { id: "attach-build", title: "Attach build", phase: "listing", needs: [] };

/** @param {import("../core/context.mjs").OperationContext} ctx */
export async function run({ client, discovery, options = {} }) {
  const build = options.build ? await discovery.latestBuild(options.build) : await discovery.latestValidBuild();
  if (!build) return { status: Status.ERROR, message: "no VALID build found — run `eas build` + `eas submit` first" };

  const version = await discovery.editableVersion();
  const current = await discovery.attachedBuild(version.id);
  if (current?.id === build.id)
    return { status: Status.OK, message: `build ${build.attributes.version} already attached` };

  await client.patch(`/v1/appStoreVersions/${version.id}/relationships/build`, {
    data: { type: "builds", id: build.id },
  });
  return { status: Status.CHANGED, message: `attached build ${build.attributes.version}` };
}
