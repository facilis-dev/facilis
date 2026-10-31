// Streaming extraction of the top-level `message` field from the AIResponse JSON (SPEC §9.2).
//
// A provider answer arrives as a growing prefix of one JSON object that is not valid JSON
// until its last byte, so JSON.parse cannot be used while the panel is still receiving it.
// This module walks that prefix as a JSON tokenizer: it tracks string state/escapes and
// brace/bracket depth so a "message" inside patch content can never match, then decodes the
// value from its opening quote and treats the end of the prefix as the end of the visible
// text. Pure and total: every input yields a prefix or null.

const MESSAGE_CAP = 20_000;

interface KeyToken {
  value: string;
  /** Index of the closing quote, so scanning can continue after the key. */
  end: number;
}

interface Escape {
  text: string;
  end: number;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function skipWhitespace(raw: string, start: number): number {
  let index = start;
  while (index < raw.length && isWhitespace(raw[index])) index += 1;
  return index;
}

/** Decode one JSON escape at `start` (the backslash); null if it is incomplete or unknown. */
function readEscape(raw: string, start: number): Escape | null {
  switch (raw[start + 1]) {
    case '"':
      return { text: '"', end: start + 2 };
    case "\\":
      return { text: "\\", end: start + 2 };
    case "/":
      return { text: "/", end: start + 2 };
    case "b":
      return { text: "\b", end: start + 2 };
    case "f":
      return { text: "\f", end: start + 2 };
    case "n":
      return { text: "\n", end: start + 2 };
    case "r":
      return { text: "\r", end: start + 2 };
    case "t":
      return { text: "\t", end: start + 2 };
    case "u": {
      const hex = raw.slice(start + 2, start + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return null;
      return { text: String.fromCharCode(Number.parseInt(hex, 16)), end: start + 6 };
    }
    default:
      return null;
  }
}

/** Decode a key string at its opening quote; null while the prefix has not closed it. */
function readKey(raw: string, start: number): KeyToken | null {
  let value = "";
  let index = start + 1;
  while (index < raw.length) {
    const char = raw[index];
    if (char === '"') return { value, end: index };
    if (char === "\\") {
      const escape = readEscape(raw, index);
      if (escape === null) return null;
      value += escape.text;
      index = escape.end;
      continue;
    }
    value += char;
    index += 1;
  }
  return null;
}

/** Index of the closing quote of the value string at `start`, or null while incomplete. */
function skipString(raw: string, start: number): number | null {
  let index = start + 1;
  while (index < raw.length) {
    const char = raw[index];
    if (char === '"') return index;
    if (char === "\\") {
      const escape = readEscape(raw, index);
      if (escape === null) return null;
      index = escape.end;
      continue;
    }
    index += 1;
  }
  return null;
}

/** Decode the visible prefix of the string value at `start` (its opening quote). */
function decodeValue(raw: string, start: number): string {
  let value = "";
  let index = start + 1;
  while (index < raw.length && value.length < MESSAGE_CAP) {
    const char = raw[index];
    if (char === '"') return value;
    if (char === "\\") {
      const escape = readEscape(raw, index);
      // An incomplete escape (or an incomplete \u) ends the visible prefix here.
      if (escape === null) return value;
      value += escape.text;
      index = escape.end;
      continue;
    }
    value += char;
    index += 1;
  }
  return value.length > MESSAGE_CAP ? value.slice(0, MESSAGE_CAP) : value;
}

/** Read `": <string>` after the message key; null until the value's first quote is present. */
function readMessageValue(raw: string, from: number): string | null {
  let index = skipWhitespace(raw, from);
  if (index >= raw.length || raw[index] !== ":") return null;
  index = skipWhitespace(raw, index + 1);
  if (index >= raw.length || raw[index] !== '"') return null;
  return decodeValue(raw, index);
}

/** The decoded value of the top-level "message" string in a partial AIResponse JSON, or null. */
export function streamingMessage(raw: string): string | null {
  const objectStart = raw.indexOf("{");
  if (objectStart === -1) return null;

  let depth = 1;
  // At depth 1 only an actual key may be quoted; a top-level string `value` must not be
  // mistaken for the key (e.g. {"notes":"message"}), so key position is tracked separately.
  let expectKey = true;
  let index = objectStart + 1;

  while (index < raw.length) {
    const char = raw[index];

    if (char === '"') {
      if (depth === 1 && expectKey) {
        const key = readKey(raw, index);
        if (key === null) return null;
        if (key.value === "message") return readMessageValue(raw, key.end + 1);
        expectKey = false;
        index = key.end + 1;
        continue;
      }
      const end = skipString(raw, index);
      if (end === null) return null;
      index = end + 1;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;
      index += 1;
      // The top-level object closed before a message key appeared.
      if (depth === 0) return null;
      continue;
    }

    if (char === "," && depth === 1) expectKey = true;
    index += 1;
  }

  return null;
}
