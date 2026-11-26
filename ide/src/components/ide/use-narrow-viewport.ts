// Narrow-viewport detection for the graph surface (#191). The drawer becomes a bottom sheet
// below the same breakpoint the rich card uses, and the surface reserves the sheet height in
// fit/centre. A matchMedia store keeps every consumer (drawer, surface chrome, camera) on the
// same answer without prop drilling through the panel.

import { useSyncExternalStore } from "react";
import { DRAWER_SHEET_BREAKPOINT } from "@/facilis/graph-surface/safe-area.ts";

const NARROW_QUERY = `(max-width: ${DRAWER_SHEET_BREAKPOINT - 1}px)`;

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(NARROW_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  if (query === null) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return mediaQuery()?.matches ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

/** True below the sheet breakpoint; reactive to rotation and window resize. */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
