// Uploads all PNGs from config.screenshots.dir to the version's screenshot set,
// replacing whatever is there. Filename order = display order.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Status } from "../core/status.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "screenshots",
  title: "Screenshots",
  phase: "listing",
  needs: ["screenshots"],
  mutates: true,
  destructive: true,
  args: {
    prune: {
      type: "boolean",
      default: true,
      description: "delete remote screenshots that have no local counterpart",
    },
    displayType: {
      type: "string",
      description: "override config.screenshots.displayType",
    },
  },
};

export async function run({ client, discovery, uploader, config, resolvePath }, args = {}) {
  const dir = config?.screenshots?.dir;
  if (!dir) return { status: Status.ERROR, message: "config.screenshots.dir is required" };

  const absDir = resolvePath(dir, "config.screenshots.dir");
  const files = readdirSync(absDir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();
  if (!files.length) return { status: Status.ERROR, message: `no PNGs found in ${dir}` };

  const displayType = args.displayType || config.screenshots.displayType || "APP_IPHONE_67";
  const version = await discovery.editableVersion();
  const verLoc = await discovery.versionLocalization(version.id, config.locale);

  const sets = await client.get(`/v1/appStoreVersionLocalizations/${verLoc.id}/appScreenshotSets?limit=50`);
  let set = sets.data.find((s) => s.attributes.screenshotDisplayType === displayType);
  if (!set) {
    set = (
      await client.post(`/v1/appScreenshotSets`, {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: displayType },
          relationships: {
            appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: verLoc.id } },
          },
        },
      })
    ).data;
  } else {
    const existing = await client.get(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
    for (const sc of existing.data) await client.delete(`/v1/appScreenshots/${sc.id}`);
  }

  const ids = [];
  for (const file of files) {
    ids.push(
      await uploader.upload({
        reservePath: `/v1/appScreenshots`,
        type: "appScreenshots",
        relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } },
        filePath: join(absDir, file),
        fileName: file,
      }),
    );
  }
  await client.patch(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
    data: ids.map((id) => ({ type: "appScreenshots", id })),
  });
  return { status: Status.CHANGED, message: `${files.length} screenshots (${displayType})` };
}
