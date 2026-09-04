// One config can describe several App Store locales.
//
// `config.locale` + `config.metadata` was a single-locale assumption baked into
// every operation. An app listed in more than one language got exactly one
// localization filled and the rest left empty — which Apple then rejects, with
// nothing in this tool saying so. `config.locales` fixes that, and the flat form
// stays as shorthand for the common single-locale case.

/**
 * @typedef {Object} LocaleEntry
 * @property {string} locale
 * @property {Record<string, any>} metadata   the flat metadata with this locale's overrides applied
 * @property {boolean} primary                the locale a single-locale config would have used
 */

/**
 * Every locale this config describes, primary first.
 *
 * `config.metadata` acts as the default for all of them, and each entry in
 * `config.locales` overrides it — so shared fields (keywords that happen to be
 * identical, a URL that does not change) are written once.
 *
 * @param {object|null} config
 * @returns {LocaleEntry[]}
 */
export function resolveLocales(config) {
  if (!config) return [];
  const base = config.metadata ?? {};
  const primary = config.locale;

  if (!config.locales || Object.keys(config.locales).length === 0) {
    return primary ? [{ locale: primary, metadata: base, primary: true }] : [];
  }

  const entries = Object.entries(config.locales).map(([locale, overrides]) => ({
    locale,
    metadata: { ...base, ...(overrides ?? {}) },
    primary: locale === primary,
  }));

  // Primary first: it is the one a reader thinks of as "the" listing, and the
  // one whose failure matters most in a report.
  entries.sort((a, b) => Number(b.primary) - Number(a.primary));

  // A `locale` naming something absent from `locales` is almost certainly a
  // mistake, but writing nothing at all would be worse — include it.
  if (primary && !entries.some((e) => e.locale === primary)) {
    entries.unshift({ locale: primary, metadata: base, primary: true });
  }
  return entries;
}

/** Just the locale codes, primary first. @param {object|null} config */
export const localeCodes = (config) => resolveLocales(config).map((e) => e.locale);

/** The locale a report defaults to when the caller did not name one. */
export const primaryLocale = (config) => resolveLocales(config)[0]?.locale ?? null;
