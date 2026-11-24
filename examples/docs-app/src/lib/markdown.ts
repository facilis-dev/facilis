/**
 * Markdown rendering for the docs pipeline (example-local convention, issue #163).
 *
 * marked is the renderer: pure JS with zero dependencies, so it installs fast in the
 * WebContainer and bundles identically for the client and the prerender SSR sub-build.
 * Rendering is a pure function of the source text — no build-time plugin — which is what
 * keeps prerendered HTML and client hydration identical (D-202).
 *
 * Headings get slug ids so the per-page table of contents can anchor them. The TOC and
 * the renderer derive ids from the SAME pure slug function, in document order, without
 * shared mutable state: that stays correct under StrictMode double renders and hydration.
 * Convention: one heading text per page (duplicate texts would share an id).
 */

import { Marked, type Tokens } from "marked";

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

/** Unicode-aware slug: "Perché MDX?" -> "perché-mdx". Empty text keeps a stable fallback. */
export function slugHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "section" : slug;
}

const ATX_HEADING = /^(#{2,3})\s+(.+?)\s*#*\s*$/;
const FENCE = /^(```|~~~)/;

/**
 * The page TOC: depth-2/3 ATX headings in document order, skipping fenced code blocks.
 * A line scan (not the Markdown AST) so .md and .mdx share one extraction path.
 */
export function extractHeadings(body: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line.trim())) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = ATX_HEADING.exec(line);
    if (match === null) continue;
    const depth = match[1]?.length === 2 ? 2 : 3;
    const text = (match[2] ?? "").trim();
    entries.push({ id: slugHeading(text), text, depth });
  }
  return entries;
}

const md = new Marked({
  renderer: {
    heading(token: Tokens.Heading): string {
      const id = slugHeading(token.text);
      const inner = this.parser.parseInline(token.tokens);
      return "<h" + token.depth + ' id="' + id + '">' + inner + "</h" + token.depth + ">\n";
    },
  },
});

/** Render a Markdown body to HTML. Content is authored project source, not user input. */
export function renderMarkdown(body: string): string {
  return md.parse(body, { async: false });
}
