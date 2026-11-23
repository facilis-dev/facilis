import { createContext, useContext } from "react";

// The serialized public state embedded at build time; null when the page boots
// as the SPA shell (no prerendered data, client fetch path).
export interface PrerenderState {
  url: string;
  data: unknown;
}

export const PrerenderDataContext = createContext<PrerenderState | null>(null);

export function usePrerenderData(): PrerenderState | null {
  return useContext(PrerenderDataContext);
}
