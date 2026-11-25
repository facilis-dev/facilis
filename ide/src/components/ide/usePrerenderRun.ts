// The prerender run store as a hook (issue #85): the satellite button narrates the
// phase and the preview badge refetches when a build settles.
import { useSyncExternalStore } from "react";
import {
  getPrerenderRun,
  subscribePrerenderRun,
  type PrerenderRunState,
} from "@/facilis/prerender-run";

export function usePrerenderRun(): PrerenderRunState | null {
  return useSyncExternalStore(subscribePrerenderRun, getPrerenderRun);
}
