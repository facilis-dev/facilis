/**
 * The prerender state island (D-202 §4): one `<script type="application/json"
 * id="prerender-data">` per document, XSS-escaped JSON of public API responses keyed by
 * request path — never the session, never an identity.
 *
 * Dependency-free on purpose: the static-template entry (`prerender.ts`) may import this
 * under the D-202/D-168 module-graph constraint, and the generated-project runtime keeps a
 * project-local mirror of the parse semantics (a parity test asserts they agree).
 */

export const PRERENDER_ISLAND_ID = "prerender-data";

/** Plain-object map of request path -> public API response body. */
export type PrerenderIsland = Readonly<Record<string, unknown>>;

/**
 * Serialize with the five escapes that keep a JSON island inert inside HTML: `<`, `>`,
 * `&` (no tag/sequence can open) and U+2028/U+2029 (JS line terminators, for classic-script
 * consumers). Plain JSON.stringify alone is an XSS hole (the Arm B rejection, D-202).
 */
export function serializeIsland(data: PrerenderIsland): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Parse an island body; null on anything that is not a plain JSON object (corrupt, array,
 * scalar). The caller falls back to client rendering — a bad island never crashes the boot.
 */
export function parseIsland(text: string | null): Record<string, unknown> | null {
  if (text === null || text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** The island tag injected before `</head>` at build time. */
export function islandScriptTag(data: PrerenderIsland): string {
  return `<script type="application/json" id="${PRERENDER_ISLAND_ID}">${serializeIsland(data)}</script>`;
}
