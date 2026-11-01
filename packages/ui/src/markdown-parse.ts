/**
 * Small, dependency-free Markdown parser for the kit renderer.
 *
 * It deliberately supports a fixed, safe subset: raw HTML is never parsed, it stays text. The
 * renderer turns this AST into React elements, so nothing is ever injected as HTML.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "break" };

export type MarkdownBlock =
  | { type: "heading"; level: number; content: string }
  | { type: "paragraph"; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; content: string }
  | { type: "code"; language: string | undefined; content: string }
  | { type: "hr" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```(\S*)\s*$/;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEME = /^(?:https?:\/\/|mailto:)/i;
const BACKTICK = String.fromCharCode(96);

export function isSafeLink(href: string): boolean {
  const target = href.trim();
  if (target === "") return false;
  if (target.startsWith("#")) return true;
  if (SAFE_SCHEME.test(target)) return true;
  return !EXPLICIT_SCHEME.test(target);
}

function isBlockStart(line: string): boolean {
  return (
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    HR.test(line) ||
    FENCE.test(line) ||
    line.startsWith(">")
  );
}

export function parseInline(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = "";
  let index = 0;

  const flushText = (): void => {
    if (text === "") return;
    nodes.push({ type: "text", value: text });
    text = "";
  };

  while (index < input.length) {
    const char = input.charAt(index);

    if (char === "\n") {
      flushText();
      nodes.push({ type: "break" });
      index += 1;
      continue;
    }

    if (char === BACKTICK) {
      const end = input.indexOf(BACKTICK, index + 1);
      if (end > index + 1) {
        flushText();
        nodes.push({ type: "code", value: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (char === "[") {
      const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(input.slice(index));
      if (link !== null) {
        flushText();
        nodes.push({
          type: "link",
          href: link[2] ?? "",
          children: parseInline(link[1] ?? ""),
        });
        index += link[0].length;
        continue;
      }
    }

    if (input.startsWith("**", index) || input.startsWith("__", index)) {
      const marker = input.slice(index, index + 2);
      const end = input.indexOf(marker, index + 2);
      if (end > index + 2) {
        flushText();
        nodes.push({ type: "strong", children: parseInline(input.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const end = input.indexOf(char, index + 1);
      if (end > index + 1) {
        flushText();
        nodes.push({ type: "em", children: parseInline(input.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }

    text += char;
    index += 1;
  }

  flushText();
  return nodes;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", language: fence[1] || undefined, content: code.join("\n") });
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({
        type: "heading",
        level: (heading[1] ?? "#").length,
        content: heading[2] ?? "",
      });
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", content: quote.join("\n") });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = BULLET.exec(lines[index] ?? "");
        if (match === null) break;
        items.push(match[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered !== null) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = NUMBERED.exec(lines[index] ?? "");
        if (match === null) break;
        items.push(match[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (current.trim() === "" || (paragraph.length > 0 && isBlockStart(current))) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", content: paragraph.join("\n") });
  }

  return blocks;
}
