// The one tour store for the whole app.
//
// It lives outside React so the TitleBar and the command palette can replay the
// tour without mounting a hook; the overlay binds to it with useSyncExternalStore
// (see use-tour.ts).
import { aiAvailable, deployment } from "@/deploy/current";
import {
  createTourStore,
  TOUR_STORAGE_KEY,
  type TourStorage,
  type TourStore,
} from "@/tour/tour-store";
import { tourStepsFor } from "@/tour/tour-steps";
import type { TourStep } from "@/tour/tour-types";

/** localStorage when the browser allows it, else an in-memory value for this page.
 * Any storage failure (disabled, quota, private mode) permanently falls back; the
 * tour must never break because remembering "seen" failed. */
function createTourStorage(): TourStorage {
  let memory: string | null = null;
  let persistent: Storage | null | undefined;

  const target = (): Storage | null => {
    if (persistent !== undefined) return persistent;
    try {
      persistent = typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      persistent = null;
    }
    return persistent;
  };

  return {
    get() {
      const store = target();
      if (store === null) return memory;
      try {
        return store.getItem(TOUR_STORAGE_KEY);
      } catch {
        persistent = null;
        return memory;
      }
    },
    set(value) {
      memory = value;
      const store = target();
      if (store === null) return;
      try {
        if (value === null) store.removeItem(TOUR_STORAGE_KEY);
        else store.setItem(TOUR_STORAGE_KEY, value);
      } catch {
        persistent = null;
      }
    },
  };
}

// The chat step disappears when the build has no AI (D-063), so the store and the
// overlay have to derive the same list from the same deployment.
const steps: readonly TourStep[] = tourStepsFor({ chatEnabled: aiAvailable(deployment) });

export const tourSteps: readonly TourStep[] = steps;

export const tourStore: TourStore = createTourStore({ storage: createTourStorage(), steps });
