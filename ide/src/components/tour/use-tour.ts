import { useCallback, useSyncExternalStore } from "react";
import type { TourSnapshot } from "@/tour/tour-store";
import type { TourStep } from "@/tour/tour-types";
import { tourSteps, tourStore } from "./tour-store-instance";

export interface UseTour {
  readonly snapshot: TourSnapshot;
  readonly steps: readonly TourStep[];
  readonly next: () => void;
  readonly prev: () => void;
  readonly skip: () => void;
}

/** Bind the module-level store to React. The store keeps snapshot identity stable
 * between changes, which is what useSyncExternalStore requires. */
export function useTour(): UseTour {
  const snapshot = useSyncExternalStore(tourStore.subscribe, tourStore.getSnapshot);
  const next = useCallback(() => tourStore.next(), []);
  const prev = useCallback(() => tourStore.prev(), []);
  const skip = useCallback(() => tourStore.skip(), []);
  return { snapshot, steps: tourSteps, next, prev, skip };
}
