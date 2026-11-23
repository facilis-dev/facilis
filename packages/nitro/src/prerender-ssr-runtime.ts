/**
 * Build-time SSR render for the prerender pass (D-202 §1/§4, Arm C). Consumed only by the
 * generated SSR entry that `prerender-engine.ts` bundles and imports in-process — never by
 * the client bundle, never by the static plugin entry's module graph.
 *
 * `react-dom/static` `prerender` waits for all data and hoists React 19 document metadata
 * (`<title>`/`<meta>`/`<link>`) to the front of the prelude; the hoisted run becomes the
 * document head, the rest the `#root` body. Data is pre-fetched, so the render is
 * deterministic and identical to the first client render (no refetch-before-hydrate).
 */

import { createElement, type ComponentType, type ReactNode } from "react";
import { prerender } from "react-dom/static";
// react-router-dom 7.x exports StaticRouter from the main entry (the ./server subpath is gone).
import { StaticRouter } from "react-router-dom";

export interface PrerenderDataProviderProps {
  readonly data: Readonly<Record<string, unknown>>;
  readonly children: ReactNode;
}

export interface PrerenderRenderInput {
  /** The declared page path, verbatim (StaticRouter location). */
  readonly route: string;
  /** Public API responses keyed by request path; empty for a purely static page. */
  readonly data: Readonly<Record<string, unknown>>;
  /** The project's one route table component (src/app.tsx, D-058). */
  readonly app: ComponentType;
  /** The project's island provider (src/lib/prerender.tsx), when present. */
  readonly provider?: ComponentType<PrerenderDataProviderProps>;
}

export interface PrerenderRenderOutput {
  /** Hoisted document metadata (`<title>`/`<meta>`/`<link>`), possibly empty. */
  readonly head: string;
  /** The rendered page markup for `<div id="root">`. */
  readonly body: string;
}

/** Render one allowlisted route with the identical client tree. */
export async function renderPrerenderRoute(input: PrerenderRenderInput): Promise<PrerenderRenderOutput> {
  const router = createElement(StaticRouter, { location: input.route }, createElement(input.app));
  const tree =
    input.provider === undefined
      ? router
      : createElement(input.provider, { data: input.data, children: router });
  const { prelude } = await prerender(tree);
  const reader = prelude.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return splitHoistedHead(html);
}

/**
 * Split the leading hoisted-metadata run off a prerender prelude. React emits hoistable
 * elements first; the first non-hoistable tag starts the body. Attribute values may contain
 * `>`, so the void-tag scan tracks quotes instead of stopping at the first `>`.
 */
export function splitHoistedHead(html: string): PrerenderRenderOutput {
  let rest = html;
  let head = "";
  for (;;) {
    const match = /^<(title|meta|link|base)(?=[\s/>])/.exec(rest);
    if (match === null) break;
    const tag = match[1];
    const end = tag === "title" ? closingTagEnd(rest, "</title>") : voidTagEnd(rest);
    if (end === -1) break;
    head += rest.slice(0, end);
    rest = rest.slice(end);
  }
  return { head, body: rest };
}

function closingTagEnd(html: string, closing: string): number {
  const index = html.indexOf(closing);
  return index === -1 ? -1 : index + closing.length;
}

/** End of a void element (`<meta .../>`, `<link ...>`), quote-aware. */
function voidTagEnd(html: string): number {
  let quote: string | null = null;
  for (let index = 1; index < html.length; index += 1) {
    const char = html[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index + 1;
    }
  }
  return -1;
}
