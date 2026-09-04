// The operation registry. One import list, one map, one pipeline order — so
// `listOperations()` can describe the whole surface to a CLI, an MCP server or a
// help screen without any of them hardcoding the set.

import * as status from "./status.mjs";
import * as check from "./check.mjs";
import * as credentials from "./credentials.mjs";
import * as attachBuild from "./attach-build.mjs";
import * as metadata from "./metadata.mjs";
import * as pricing from "./pricing.mjs";
import * as contentRights from "./content-rights.mjs";
import * as ageRating from "./age-rating.mjs";
import * as category from "./category.mjs";
import * as reviewInfo from "./review-info.mjs";
import * as screenshots from "./screenshots.mjs";
import * as subscription from "./subscription.mjs";
import * as submit from "./submit.mjs";

/**
 * @typedef {Object} OperationMeta
 * @property {string} id
 * @property {string} title
 * @property {"build"|"listing"|"submit"} phase
 * @property {string[]} needs                    config concerns, enforced before the operation runs
 * @property {boolean} [mutates]
 * @property {boolean} [destructive]             can delete data that already exists in ASC
 * @property {boolean} [irreversible]            cannot be undone through the API
 * @property {Record<string, import("../cli/args.mjs").FlagSpec>} [args]
 */

/** @typedef {{ meta: OperationMeta, run: (ctx: any, args?: any) => Promise<any> }} Operation */

/** @type {Record<string, Operation>} */
export const OPERATIONS = {
  status,
  check,
  credentials,
  submit,
  "attach-build": attachBuild,
  metadata,
  pricing,
  "content-rights": contentRights,
  "age-rating": ageRating,
  category,
  "review-info": reviewInfo,
  screenshots,
  subscription,
};

/**
 * Order of the listing pipeline (`release`). Every step is idempotent, and a
 * build must already exist — attach-build is first for that reason.
 */
export const PIPELINE = Object.freeze([
  "attach-build",
  "metadata",
  "pricing",
  "content-rights",
  "age-rating",
  "category",
  "review-info",
  "screenshots",
  "subscription",
]);

/** @param {string} id */
export const getOperation = (id) => OPERATIONS[id] ?? null;

export const operationIds = () => Object.keys(OPERATIONS);
