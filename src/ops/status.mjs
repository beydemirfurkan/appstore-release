// Read-only inventory of the app's App Store Connect state.
// A projection of the snapshot — the data is returned, not only printed, so a
// library or an agent can use it without scraping stdout.

import { Status } from "../core/status.mjs";
import { getAppSnapshot } from "../report/snapshot.mjs";
import { renderSnapshotText } from "../report/render.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "status",
  title: "Status",
  phase: "listing",
  needs: [],
  mutates: false,
};

/** @param {import("../core/context.mjs").Context} ctx */
export async function run(ctx) {
  const snapshot = await getAppSnapshot(ctx);
  for (const line of renderSnapshotText(snapshot).split("\n")) ctx.log.info(line);
  return {
    status: Status.OK,
    message: snapshot.app?.attributes?.name ?? ctx.appId,
    details: snapshot,
  };
}
