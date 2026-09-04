// A validator for exactly the JSON Schema keywords our own schema uses.
//
// Not ajv, on purpose. These messages are user-facing findings with a "how to
// fix" line, which is strictly more useful than `/metadata/keywords must NOT
// have more than 100 characters` — and the keyword set is closed by construction,
// because we author the schema. CI still runs ajv over the schema itself to
// prove it is valid draft 2020-12 and that the template satisfies it.

import { finding, Severity, Category, FixOwner } from "./findings.mjs";

/** Formats we check. Anything else is documentation only. */
const FORMATS = {
  uri: (v) => /^https?:\/\/[^\s]+$/i.test(v),
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
};

/**
 * @param {any} config
 * @param {any} schema
 * @returns {import("./findings.mjs").Finding[]}
 */
export function validateAgainstSchema(config, schema) {
  /** @type {import("./findings.mjs").Finding[]} */
  const out = [];
  walk(config, schema, "", out);
  return out;
}

function walk(value, schema, path, out) {
  if (value === undefined || schema == null) return;

  if (schema.type && !typeMatches(value, schema.type)) {
    return push(
      out,
      path,
      "type",
      `should be ${schema.type}, got ${describe(value)}`,
      `Change it to a ${schema.type}.`,
    );
  }

  if (schema.enum && !schema.enum.includes(value)) {
    return push(
      out,
      path,
      "enum",
      `"${value}" is not one of the accepted values`,
      `Use one of: ${schema.enum.join(", ")}.`,
    );
  }

  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) {
      push(out, path, "minLength", `is shorter than ${schema.minLength} characters`, "Provide a real value.");
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      push(
        out,
        path,
        "maxLength",
        `is ${value.length} characters; App Store Connect accepts at most ${schema.maxLength}`,
        `Shorten it to ${schema.maxLength} characters or fewer.`,
      );
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      push(out, path, "pattern", `"${value}" is not in the expected form`, schema.description ?? "Check the format.");
    }
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](value)) {
      push(out, path, "format", `"${value}" is not a valid ${schema.format}`, `Provide a valid ${schema.format}.`);
    }
  }

  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) {
    push(out, path, "minimum", `is below the minimum of ${schema.minimum}`, `Use ${schema.minimum} or more.`);
  }

  if (schema.type === "object" || schema.properties) {
    if (!isPlainObject(value)) return;

    for (const key of schema.required ?? []) {
      if (value[key] == null || value[key] === "") {
        push(out, join(path, key), "required", "is required", "Add it to your config.", Severity.BLOCKER);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (schema.properties?.[key]) continue;
        // A typo like `metadata.keyword` used to sail through and simply do
        // nothing, which is the most expensive kind of silent failure.
        push(
          out,
          join(path, key),
          "unknown",
          "is not a recognised setting",
          suggest(key, Object.keys(schema.properties ?? {})),
          Severity.WARNING,
        );
      }
    }

    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      walk(value[key], sub, join(path, key), out);
    }
  }
}

/**
 * @param {import("./findings.mjs").Finding[]} out
 * @param {string} path
 * @param {string} keyword
 * @param {string} detail
 * @param {string} fix
 * @param {import("./findings.mjs").Finding["severity"]} [severity]
 */
function push(out, path, keyword, detail, fix, severity = Severity.BLOCKER) {
  const where = path || "<config root>";
  out.push(
    finding({
      id: `config.${path || "root"}.${keyword}`,
      severity,
      category: Category.CONFIG,
      title: `config.${where} ${detail}`,
      detail: `Schema keyword: ${keyword}.`,
      fixOwner: FixOwner.CLI,
      fix,
      evidence: { resource: "config", expected: keyword },
    }),
  );
}

/** Name the closest known key, since a typo is the usual cause. */
function suggest(key, known) {
  const best = known.map((k) => ({ k, d: distance(key.toLowerCase(), k.toLowerCase()) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d <= 3
    ? `Did you mean "${best.k}"? Run \`appstore-release schema\` for the full shape.`
    : "Remove it, or run `appstore-release schema` for the accepted settings.";
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

const join = (path, key) => (path ? `${path}.${key}` : key);
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const describe = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

function typeMatches(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    if (t === "object") return isPlainObject(value);
    if (t === "array") return Array.isArray(value);
    if (t === "number") return typeof value === "number";
    if (t === "integer") return Number.isInteger(value);
    if (t === "null") return value === null;
    return typeof value === t;
  });
}
