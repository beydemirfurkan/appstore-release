// Terminal colour, and nothing else. On only for a real terminal, off for pipes,
// files and --json's stderr; NO_COLOR and FORCE_COLOR are honoured
// (https://no-color.org). Everything that formats text takes a Style, so the
// same renderer produces plain text for a log file and colour for a person.

const CODES = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], cyan: [36, 39] };

/** @typedef {Record<keyof typeof CODES, (s: string) => string> & { enabled: boolean }} Style */

/** @type {Style} */
export const PLAIN = Object.freeze(
  /** @type {Style} */ ({
    enabled: false,
    ...Object.fromEntries(Object.keys(CODES).map((k) => [k, (/** @type {string} */ s) => s])),
  }),
);

/**
 * @param {{ isTTY?: boolean }} stream
 * @param {Record<string, string|undefined>} [env]
 * @returns {Style}
 */
export function createStyle(stream, env = process.env) {
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0";
  const on = forced || (Boolean(stream?.isTTY) && env.NO_COLOR === undefined && env.TERM !== "dumb");
  if (!on) return PLAIN;
  return /** @type {Style} */ ({
    enabled: true,
    ...Object.fromEntries(
      Object.entries(CODES).map(([k, [open, close]]) => [
        k,
        (/** @type {string} */ s) => `\x1b[${open}m${s}\x1b[${close}m`,
      ]),
    ),
  });
}
