// Argument parsing driven by the operation registry, so a flag declared in an
// operation's `meta.args` is automatically accepted. The previous parser only
// looked for two literal strings, which is why the documented `--build` flag was
// silently ignored for its whole life.

export class UsageError extends Error {}

/**
 * @typedef {Object} FlagSpec
 * @property {"string"|"boolean"|"number"} type
 * @property {string} description
 * @property {string} [alias]
 * @property {any} [default]
 */

/**
 * Flags every command accepts.
 * @type {Readonly<Record<string, FlagSpec>>}
 */
export const GLOBAL_FLAGS = Object.freeze({
  config: { type: "string", description: "path to the config file" },
  "project-root": {
    type: "string",
    description: "base directory for relative paths (default: the config's directory)",
  },
  "app-id": { type: "string", description: "numeric App Store Connect app id" },
  "key-id": { type: "string", description: "ASC API key id" },
  "issuer-id": { type: "string", description: "ASC API issuer id" },
  p8: { type: "string", description: "path to the AuthKey_*.p8" },
  json: { type: "boolean", description: "emit one JSON document on stdout; human output moves to stderr" },
  "dry-run": { type: "boolean", description: "plan every mutation, perform none" },
  yes: { type: "boolean", alias: "y", description: "confirm destructive and irreversible operations" },
  verbose: { type: "boolean", description: "show every HTTP request" },
  quiet: { type: "boolean", description: "results only" },
  "exit-zero": { type: "boolean", description: "always exit 0; read the JSON instead" },
  help: { type: "boolean", alias: "h", description: "show this help" },
  version: { type: "boolean", alias: "v", description: "print the version" },
});

/**
 * @param {string[]} argv
 * @param {Record<string, FlagSpec>} [opFlags]
 * @returns {{ command: string|null, flags: Record<string, any>, positionals: string[] }}
 */
export function parseArgs(argv, opFlags = {}) {
  const spec = { ...GLOBAL_FLAGS, ...opFlags };
  const byAlias = new Map();
  for (const [name, def] of Object.entries(spec)) if (def.alias) byAlias.set(def.alias, name);

  /** @type {Record<string, any>} */
  const flags = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const isLong = token.startsWith("--");
    let raw = isLong ? token.slice(2) : token.slice(1);
    let inlineValue;
    const eq = raw.indexOf("=");
    if (eq !== -1) {
      inlineValue = raw.slice(eq + 1);
      raw = raw.slice(0, eq);
    }

    const negated = isLong && raw.startsWith("no-") && spec[raw.slice(3)]?.type === "boolean";
    const name = negated ? raw.slice(3) : (byAlias.get(raw) ?? raw);
    const def = spec[name];
    if (!def) throw new UsageError(`Unknown flag: ${token}`);

    if (def.type === "boolean") {
      if (inlineValue !== undefined) throw new UsageError(`${token} does not take a value`);
      flags[name] = !negated;
      continue;
    }

    const value = inlineValue ?? argv[++i];
    if (value === undefined) throw new UsageError(`${token} requires a value`);
    flags[name] = def.type === "number" ? Number(value) : value;
  }

  return { command: positionals.shift() ?? null, flags, positionals };
}

/** Split parsed flags into the global ones and the operation's own. */
export function splitFlags(flags, opFlags = {}) {
  const opArgs = {};
  const globals = {};
  for (const [k, v] of Object.entries(flags)) {
    if (Object.hasOwn(opFlags, k)) opArgs[camel(k)] = v;
    else globals[camel(k)] = v;
  }
  return { globals, opArgs };
}

/** `--project-root` reaches the code as `projectRoot`. */
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
