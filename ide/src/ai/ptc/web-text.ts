// HTML-to-text reduction for web_fetch (D-175).
//
// A fetched page is untrusted data the model reads as text, so keeping the markup would waste
// its character budget and read worse than the page's own prose. This is deliberately a light
// reduction — script/style dropped, block boundaries as newlines, a few entities decoded — not
// an HTML parser: model-facing text does not justify a parser dependency.

/** Named entities worth decoding in prose; numeric entities are handled separately. */
const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  // "&amp;" is decoded last so "&amp;lt;" cannot turn into a tag after the tags are stripped.
  return text
    .replace(/&([a-z]+);/gi, (match: string, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&#(x?)([0-9a-f]+);/gi, (match: string, radix: string, digits: string) => {
      const codePoint = Number.parseInt(digits, radix === "" ? 10 : 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&amp;/gi, "&");
}

/** Reduce an HTML document to readable text: no scripts, no styles, no tags, no blank runs. */
export function htmlToText(html: string): string {
  const withoutTags = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    // A block boundary is where a reader would start a new line; cells stay on one.
    .replace(/<\/\s*(td|th)\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  // Decode entities only after the tags are gone, so a decoded "<" cannot become markup.
  return decodeEntities(withoutTags)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
