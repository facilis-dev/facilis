import { createContext, useContext, type ReactNode } from "react";

export const PRERENDER_ISLAND_ID = "prerender-data";

export type PrerenderIsland = Record<string, unknown>;

export function parsePrerenderIsland(text: string | null): PrerenderIsland | null {
  if (text === null || text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as PrerenderIsland;
}

export function readPrerenderIsland(): PrerenderIsland | null {
  if (typeof document === "undefined") return null;
  const element = document.getElementById(PRERENDER_ISLAND_ID);
  return parsePrerenderIsland(element?.textContent ?? null);
}

let activeIsland: PrerenderIsland | null = null;
const PrerenderDataContext = createContext<PrerenderIsland | null>(null);

export function PrerenderDataProvider({ data, children }: { data: PrerenderIsland | null; children: ReactNode }) {
  activeIsland = data;
  return <PrerenderDataContext.Provider value={data}>{children}</PrerenderDataContext.Provider>;
}

export function usePrerenderData(): PrerenderIsland | null {
  return useContext(PrerenderDataContext);
}

export function hasIslandResponse(path: string): boolean {
  return activeIsland !== null && path in activeIsland;
}

export function readIslandResponse(path: string): unknown {
  return activeIsland?.[path];
}

export function shouldHydrate(container: HTMLElement, island: PrerenderIsland | null): boolean {
  return island !== null && container.childElementCount > 0;
}