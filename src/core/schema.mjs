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
  walk(config, schema, "", out, schema);
  return out;
}

/**
 * Resolve a local `$ref`. Only `#/$defs/<name>` is supported, which is the only
 * form our own schema uses — a general resolver would be code nobody exercises.
 */
function deref(schema, root) {
  if (!schema?.$ref) return schema;
  const name = schema.$ref.replace("#/$defs/", "");
  const target = root?.$defs?.[name];
  if (!target) throw new Error(`schema: cannot resolve ${schema.$ref}`);
  // Keywords alongside the $ref (a description, say) still apply.
  const { $ref, ...rest } = schema;
  return { ...target, ...rest };
}

function walk(value, rawSchema, path, out, root) {
  if (value === undefined || rawSchema == null) return;
  const schema = deref(rawSchema, root);

  // oneOf: try each branch in isolation and keep the findings of none if any
  // branch accepts. Reporting every branch's complaints would be noise —
  // "price must be a string" and "price must be an object" are both wrong.
  if (Array.isArray(schema.oneOf)) {
    const attempts = schema.oneOf.map((branch) => {
      const branchOut = [];
      walk(value, branch, path, branchOut, root);
      return branchOut;
    });
    if (attempts.some((a) => a.length === 0)) return;

    // Nothing matched. Report the branch the author clearly meant — the one
    // whose declared type matches what they actually wrote — rather than the
    // one with the fewest complaints, which for `price: {}` would be the string
    // branch saying "should be string" instead of "amount is required".
    const sameType = schema.oneOf
      .map((branch, i) => ({ branch: deref(branch, root), findings: attempts[i] }))
      .filter(({ branch }) => branch.type && typeMatches(value, branch.type));
    const pool = sameType.length ? sameType.map((x) => x.findings) : attempts;
    out.push(...pool.reduce((a, b) => (b.length < a.length ? b : a)));
    return;
  }

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

    if (schema.propertyNames?.pattern) {
      const re = new RegExp(schema.propertyNames.pattern);
      for (const key of Object.keys(value)) {
        if (re.test(key)) continue;
        push(
          out,
          join(path, key),
          "propertyNames",
          "is not a valid key here",
          `Keys must match ${schema.propertyNames.pattern} — locale codes look like "en-US" or "tr".`,
        );
      }
    }

    // An object-valued additionalProperties means "every extra key looks like
    // this", which is how `locales` is expressed.
    if (isPlainObject(schema.additionalProperties)) {
      for (const [key, sub] of Object.entries(value)) {
        if (schema.properties?.[key]) continue;
        walk(sub, schema.additionalProperties, join(path, key), out, root);
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
      walk(value[key], sub, join(path, key), out, root);
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
