// State serialization + SSR-safe boot helpers (issue #80 unknown 5).
import type { PrerenderState } from "./data-context.ts";

// XSS-escaped JSON for the inline <script type="application/json"> island:
// <, >, & and the line terminators never appear raw inside the script body.
export function serializeState(state: PrerenderState): string {
  return JSON.stringify(state)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function parseEmbeddedState(): PrerenderState | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById("prerender-data");
  if (!el || !el.textContent) return null;
  try {
    const parsed: unknown = JSON.parse(el.textContent);
    if (typeof parsed === "object" && parsed !== null && "url" in parsed && typeof parsed.url === "string") {
      return { url: parsed.url, data: "data" in parsed ? parsed.data : null };
    }
    return null;
  } catch {
    // A corrupt island degrades to the client-render path, never a crash.
    return null;
  }
}

// SSR-safe: no window/localStorage access on the server. The theme lands on
// <html data-theme> (outside the React tree), so applying it before hydrateRoot
// cannot cause a markup mismatch.
export function initTheme(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    const theme = localStorage.getItem("spike-theme");
    if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  } catch {
    // Storage can be blocked (private mode); the default theme stays.
  }
}

// SSR-safe: navigator exists only in the browser; lang lands on <html>, outside
// the hydrated tree.
export function initI18n(): void {
  if (typeof navigator === "undefined" || typeof document === "undefined") return;
  const lang = navigator.language || "en";
  document.documentElement.lang = lang;
}
