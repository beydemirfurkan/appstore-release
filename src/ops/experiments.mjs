// Product page optimization (A/B tests of the product page), through the
// current v2 experiments API: an experiment with a traffic proportion, its
// treatments (each with an optional alternate app icon), and each treatment's
// screenshots and previews per locale, placed through the App Asset Library.
//
// An experiment is edited only while it is being prepared (or after a
// rejection); in review nothing changes. Once Apple approves it, it starts
// only when the config says `start: true` — a test that changes what people
// see is never started by accident. `submit` sends a prepared experiment with
// the app, and takes it back out if App Store Connect refuses it.

import { Status } from "../core/status.mjs";
import { AssetLibrary, pruneOtherGroups, syncPlacements } from "../asc/asset-library.mjs";
import { planMedia } from "../asc/media-check.mjs";

/** Experiment states in which it can still be edited. */
export const EDITABLE_EXPERIMENT_STATES = ["PREPARE_FOR_SUBMISSION", "REJECTED"];
/** Over: a new experiment of the same name may be created. */
const FINISHED_STATES = ["COMPLETED", "STOPPED"];
const REVIEW_STATES = ["READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW"];

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "experiments",
  title: "Product page tests",
  phase: "listing",
  needs: [],
  mutates: true,
};

/**
 * @typedef {Object} ExperimentConfig
 * @property {string} name
 * @property {number} trafficProportion
 * @property {boolean} [start]
 * @property {Array<{ name: string, appIconName?: string, locales: Record<string, { screenshots?: string, previews?: string }> }>} treatments
 */

/** @param {any} config @returns {ExperimentConfig[]} */
export const experimentConfigs = (config) => (Array.isArray(config?.experiments) ? config.experiments : []);

/** @param {import("../core/context.mjs").Context} ctx */
export async function run(ctx) {
  const { client, discovery, config, resolvePath } = ctx;
  const experiments = experimentConfigs(config);
  if (!experiments.length) return { status: Status.SKIPPED, message: "none configured" };

  const assetLibrary = new AssetLibrary(client, discovery.appId);
  const library = await assetLibrary.library();
  const ref = await assetLibrary.refData();
  if (!library || !ref) {
    return {
      status: Status.ERROR,
      message: "product page tests go through the App Asset Library, which App Store Connect did not return",
    };
  }

  // Every treatment's files are checked before any request.
  /** @type {import("../core/findings.mjs").Finding[]} */
  const findings = [];
  /** @type {Map<string, Array<{ media: "image"|"video", sets: any[] }>>} */
  const media = new Map();
  for (const e of experiments) {
    for (const t of e.treatments ?? []) {
      for (const [locale, l] of Object.entries(t.locales ?? {})) {
        const plan = [];
        for (const [kind, dir] of /** @type {const} */ ([
          ["image", l.screenshots],
          ["video", l.previews],
        ])) {
          if (!dir) continue;
          const res = planMedia({
            dir: resolvePath(dir, `experiments.${e.name}.${t.name}.${locale}`),
            media: kind,
            ref,
            feature: "PRODUCT_PAGE_OPTIMIZATIONS",
            idPrefix: `experiments.${e.name}.${t.name}.${locale}.${kind}`,
            where: `Test "${e.name}", treatment "${t.name}", ${locale}`,
          });
          findings.push(...res.findings);
          plan.push({ media: kind, sets: res.sets });
        }
        media.set(key(e.name, t.name, locale), plan);
      }
    }
  }
  if (findings.length)
    return { status: Status.ERROR, message: `${findings.length} product page test file problem(s)`, findings };

  const remote = await client.all(`/v1/apps/${discovery.appId}/appStoreVersionExperimentsV2`, { limit: 200 });
  const changes = [];
  const notes = [];
  for (const e of experiments) {
    const label = `"${e.name}"`;
    let exp = remote.find((x) => x.attributes?.name === e.name && !FINISHED_STATES.includes(x.attributes?.state));
    if (!exp) {
      exp = (
        await client.post(`/v2/appStoreVersionExperiments`, {
          data: {
            type: "appStoreVersionExperiments",
            attributes: { name: e.name, platform: "IOS", trafficProportion: e.trafficProportion },
            relationships: { app: { data: { type: "apps", id: discovery.appId } } },
          },
        })
      ).data;
      changes.push(`${label} created`);
    }
    const state = exp.attributes?.state ?? "PREPARE_FOR_SUBMISSION";
    const planned = String(exp.id).startsWith("dry:");

    if (REVIEW_STATES.includes(state)) {
      notes.push(`${label} is in review`);
      continue;
    }
    if (!planned && !EDITABLE_EXPERIMENT_STATES.includes(state)) {
      // Approved, or running: only starting it is left to do here.
      if (e.start && !exp.attributes?.startDate && ["APPROVED", "ACCEPTED"].includes(state)) {
        await client.patch(`/v2/appStoreVersionExperiments/${exp.id}`, {
          data: { type: "appStoreVersionExperiments", id: exp.id, attributes: { started: true } },
        });
        changes.push(`${label} started`);
      } else if (exp.attributes?.startDate) {
        notes.push(`${label} running since ${String(exp.attributes.startDate).slice(0, 10)}`);
      } else {
        notes.push(
          `${label} is ${state.toLowerCase().replace(/_/g, " ")}${["APPROVED", "ACCEPTED"].includes(state) ? " — set start: true to start it" : ""}`,
        );
      }
      continue;
    }

    if (!planned && exp.attributes?.trafficProportion !== e.trafficProportion) {
      await client.patch(`/v2/appStoreVersionExperiments/${exp.id}`, {
        data: {
          type: "appStoreVersionExperiments",
          id: exp.id,
          attributes: { trafficProportion: e.trafficProportion },
        },
      });
      changes.push(`${label} traffic ${e.trafficProportion}%`);
    }
    await completeTreatments(ctx, e, exp, media, /** @type {any} */ (library), changes);
  }

  const tail = notes.length ? ` (${notes.join("; ")})` : "";
  return changes.length
    ? { status: Status.CHANGED, message: changes.join(" · ") + tail, findings }
    : { status: Status.OK, message: `${experiments.length} test(s) match the config${tail}`, findings };
}

/** @param {string} e @param {string} t @param {string} locale */
const key = (e, t, locale) => `${e}\u0000${t}\u0000${locale}`;

/**
 * Treatments, their localizations and media, on an editable experiment. A
 * treatment or locale the config no longer has is removed.
 *
 * @param {import("../core/context.mjs").Context} ctx
 * @param {ExperimentConfig} e
 * @param {any} exp
 * @param {Map<string, Array<{ media: "image"|"video", sets: any[] }>>} media
 * @param {{ id: string }} library
 * @param {string[]} changes
 */
async function completeTreatments(ctx, e, exp, media, library, changes) {
  const { client } = ctx;
  const label = `"${e.name}"`;
  const planned = (/** @type {string} */ id) => String(id).startsWith("dry:");
  const treatments = planned(exp.id)
    ? []
    : await client.all(`/v2/appStoreVersionExperiments/${exp.id}/appStoreVersionExperimentTreatments`, { limit: 50 });
  const wantedNames = (e.treatments ?? []).map((t) => t.name);
  for (const gone of treatments.filter((t) => !wantedNames.includes(t.attributes?.name))) {
    await client.delete(`/v1/appStoreVersionExperimentTreatments/${gone.id}`);
    changes.push(`${label} treatment "${gone.attributes?.name}" removed`);
  }

  for (const t of e.treatments ?? []) {
    let treatment = treatments.find((x) => x.attributes?.name === t.name);
    if (!treatment) {
      treatment = (
        await client.post(`/v1/appStoreVersionExperimentTreatments`, {
          data: {
            type: "appStoreVersionExperimentTreatments",
            attributes: { name: t.name, ...(t.appIconName ? { appIconName: t.appIconName } : {}) },
            relationships: {
              appStoreVersionExperimentV2: { data: { type: "appStoreVersionExperiments", id: exp.id } },
            },
          },
        })
      ).data;
      changes.push(`${label} treatment "${t.name}"`);
    } else if (t.appIconName !== undefined && (treatment.attributes?.appIconName ?? "") !== t.appIconName) {
      await client.patch(`/v1/appStoreVersionExperimentTreatments/${treatment.id}`, {
        data: {
          type: "appStoreVersionExperimentTreatments",
          id: treatment.id,
          attributes: { appIconName: t.appIconName },
        },
      });
      changes.push(`${label} "${t.name}" icon`);
    }

    const locs = planned(treatment.id)
      ? []
      : await client.all(
          `/v1/appStoreVersionExperimentTreatments/${treatment.id}/appStoreVersionExperimentTreatmentLocalizations`,
          { limit: 50 },
        );
    const wantedLocales = Object.keys(t.locales ?? {});
    for (const gone of locs.filter((x) => !wantedLocales.includes(x.attributes?.locale))) {
      await client.delete(`/v1/appStoreVersionExperimentTreatmentLocalizations/${gone.id}`);
      changes.push(`${label} "${t.name}" ${gone.attributes?.locale} removed`);
    }
    for (const locale of wantedLocales) {
      let loc = locs.find((x) => x.attributes?.locale === locale);
      if (!loc) {
        loc = (
          await client.post(`/v1/appStoreVersionExperimentTreatmentLocalizations`, {
            data: {
              type: "appStoreVersionExperimentTreatmentLocalizations",
              attributes: { locale },
              relationships: {
                appStoreVersionExperimentTreatment: {
                  data: { type: "appStoreVersionExperimentTreatments", id: treatment.id },
                },
              },
            },
          })
        ).data;
        changes.push(`${label} "${t.name}" ${locale}`);
      }
      const parent = { type: /** @type {const} */ ("appStoreVersionExperimentTreatmentLocalizations"), id: loc.id };
      for (const kind of media.get(key(e.name, t.name, locale)) ?? []) {
        let touched = false;
        for (const set of kind.sets) {
          const res = await syncPlacements(ctx, {
            library,
            parent,
            media: kind.media,
            placementGroup: set.group,
            local: set.local,
            prune: true,
          });
          touched ||= res.changed;
        }
        const stray = await pruneOtherGroups(ctx, { parent, media: kind.media, keep: kind.sets.map((x) => x.group) });
        if (touched || stray)
          changes.push(`${label} "${t.name}" ${locale} ${kind.media === "video" ? "previews" : "screenshots"}`);
      }
    }
  }
}
