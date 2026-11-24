/**
 * The docs frontmatter parser (example-local convention, issue #163).
 *
 * Content files open with a YAML-subset block delimited by `---` lines. The schema is
 * fixed — title (string), description (string), order (integer) — so a line-based parser
 * covers it without a YAML dependency: every dependency of this template must be pure JS
 * and small enough to install quickly in the WebContainer (DEV.md §6). Unknown keys are
 * ignored so content can carry extra metadata without breaking the site.
 *
 * Parsing is fail-soft on purpose: a malformed block degrades to "no frontmatter" (the
 * page still renders with a slug-derived title) instead of crashing the whole docs tree.
 */

export interface DocFrontmatter {
  title?: string;
  description?: string;
  order?: number;
}

export interface ParsedDoc {
  data: DocFrontmatter;
  body: string;
}

const DELIMITER = /^---\s*$/;
const INTEGER = /^-?\d+$/;

/** Strip one layer of matching quotes and unescape \\ and the quote character. */
function unquote(value: string): string {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.length < 2 || value.at(-1) !== quote) {
    return value;
  }
  const inner = value.slice(1, -1);
  return inner.replace(/\\(["'\\])/g, "$1");
}

function readValue(key: string, raw: string, data: DocFrontmatter): void {
  const value = unquote(raw.trim());
  if (value === "") return;
  if (key === "title") data.title = value;
  else if (key === "description") data.description = value;
  else if (key === "order" && INTEGER.test(value)) data.order = Number(value);
}

/** Split a content file into its frontmatter data and its Markdown/MDX body. */
export function parseFrontmatter(source: string): ParsedDoc {
  const lines = source.split(/\r?\n/);
  if (lines[0] === undefined || !DELIMITER.test(lines[0])) return { data: {}, body: source };
  const end = lines.findIndex((line, index) => index > 0 && DELIMITER.test(line));
  // An unterminated block is treated as body text: never throw on authored content.
  if (end === -1) return { data: {}, body: source };
  const data: DocFrontmatter = {};
  for (const line of lines.slice(1, end)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    readValue(line.slice(0, separator).trim(), line.slice(separator + 1), data);
  }
  return { data, body: lines.slice(end + 1).join("\n") };
}
