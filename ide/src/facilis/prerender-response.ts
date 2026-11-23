// How the preview badge tells a prerendered response from the SPA shell (D-202 §5,
// issue #85): the dev middleware marks prerendered HTML with x-facilis-render, and the
// state island is the body-level fallback when a proxy strips the header. Detection is
// read-only — no Service Worker change (the D-132 patch stays untouched).

export type PreviewRenderMode = "prerender" | "shell";

export const PRERENDER_RENDER_HEADER = "x-facilis-render";

export function renderModeOf(
  headers: { get(name: string): string | null },
  body: string,
): PreviewRenderMode {
  if (headers.get(PRERENDER_RENDER_HEADER) === "prerender") return "prerender";
  return body.includes('id="prerender-data"') ? "prerender" : "shell";
}
