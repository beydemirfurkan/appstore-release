// The commands that write to App Store Connect, by name. Kept here rather than
// derived from the operation registry because the readiness report needs it and
// the registry imports operations that import the report: a cycle. A test holds
// this list equal to the registry's `meta.mutates`.

export const MUTATING_COMMANDS = Object.freeze([
  "release",
  "credentials",
  "submit",
  "new-version",
  "attach-build",
  "metadata",
  "pricing",
  "content-rights",
  "age-rating",
  "category",
  "accessibility",
  "review-info",
  "release-options",
  "screenshots",
  "previews",
  "custom-product-pages",
  "subscription",
  "in-app-purchases",
  "offer-codes",
  "testflight",
  "reply",
]);

/** "appstore-release metadata --x" → true. @param {string|undefined} command */
export const writesToAppStoreConnect = (command) =>
  Boolean(command) &&
  MUTATING_COMMANDS.includes(
    String(command)
      .replace(/^appstore-release /, "")
      .split(" ")[0],
  );
