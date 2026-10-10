// A small XML property-list reader: enough for Info.plist, PrivacyInfo.xcprivacy
// and entitlements, which are XML in a source tree. Binary plists (bplist00) are
// recognised and reported as unreadable rather than misparsed.

/**
 * @param {string} text
 * @returns {{ value: any } | { error: string }}
 */
export function parsePlist(text) {
  if (text.startsWith("bplist")) return { error: "binary plist" };
  const tokens = tokenize(text);
  const start = tokens.findIndex((t) => t.type === "open" && t.name === "plist");
  if (start === -1) return { error: "not a plist" };
  let i = start + 1;

  /** @returns {any} */
  const read = () => {
    const t = tokens[i++];
    if (!t) throw new Error("unexpected end of plist");
    if (t.type === "empty")
      return t.name === "true"
        ? true
        : t.name === "false"
          ? false
          : t.name === "dict"
            ? {}
            : t.name === "array"
              ? []
              : "";
    if (t.type !== "open") throw new Error(`unexpected ${t.type} ${t.name ?? ""}`);
    switch (t.name) {
      case "dict": {
        /** @type {Record<string, any>} */
        const out = {};
        while (tokens[i] && !(tokens[i].type === "close" && tokens[i].name === "dict")) {
          const key = readText("key");
          out[key] = read();
        }
        i++;
        return out;
      }
      case "array": {
        const out = [];
        while (tokens[i] && !(tokens[i].type === "close" && tokens[i].name === "array")) out.push(read());
        i++;
        return out;
      }
      case "string":
      case "date":
      case "data":
        return closeText(t.name);
      case "integer":
        return Number.parseInt(closeText("integer"), 10);
      case "real":
        return Number.parseFloat(closeText("real"));
      default:
        throw new Error(`unsupported element <${t.name}>`);
    }
  };
  /** Text content up to the closing tag of `name`, already past the opening one. */
  const closeText = (/** @type {string} */ name) => {
    let text = "";
    while (tokens[i] && !(tokens[i].type === "close" && tokens[i].name === name)) text += tokens[i++].text ?? "";
    i++;
    return decode(text);
  };
  const readText = (/** @type {string} */ name) => {
    const t = tokens[i++];
    if (!t || t.type !== "open" || t.name !== name) throw new Error(`expected <${name}>`);
    return closeText(name);
  };

  try {
    return { value: read() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const TEXT_ELEMENTS = new Set(["key", "string", "date", "data", "integer", "real"]);

/** @param {string} text */
function tokenize(text) {
  /** @type {Array<{ type: "open"|"close"|"empty"|"text", name?: string, text?: string }>} */
  const out = [];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/?([A-Za-z]+)[^>]*?(\/)?>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].startsWith("<!--") || m[0].startsWith("<?") || m[0].startsWith("<!")) continue;
    if (m[3] !== undefined) {
      // Whitespace matters only inside a text element (<string>  </string>).
      const last = out.at(-1);
      if (m[3].trim() || (last?.type === "open" && TEXT_ELEMENTS.has(last.name ?? ""))) {
        out.push({ type: "text", text: m[3] });
      }
      continue;
    }
    const name = m[1];
    if (m[0].startsWith("</")) out.push({ type: "close", name });
    else if (m[2]) out.push({ type: "empty", name });
    else out.push({ type: "open", name });
  }
  return out;
}

/** @param {string} s */
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
