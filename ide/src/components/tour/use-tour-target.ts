import { useEffect, useState } from "react";
import type { Rect } from "@/tour/tour-geometry";
import type { TourAnchorId } from "@/tour/tour-types";
import { rectOf, TOUR_ANCHOR_SELECTORS } from "./tour-anchors";

/** How long the step action may take to put its panel in the DOM. A collapsed
 * panel mounts over a couple of frames; a boot can be slower, hence the budget. */
const RETRY_BUDGET_MS = 2000;

/**
 * The viewport rect of the active step's anchor. The step action runs around the
 * same time as this hook, so the element may not exist yet: retry across animation
 * frames for a bounded time, then keep the box fresh while panels resize.
 */
export function useTourTarget(anchor: TourAnchorId | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (anchor === null) {
      setRect(null);
      return;
    }
    const selector = TOUR_ANCHOR_SELECTORS[anchor];
    const startedAt = performance.now();
    let disposed = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;

    const refresh = (): void => {
      const next = rectOf(selector);
      if (next !== null) setRect(next);
    };

    const observe = (): void => {
      const element = document.querySelector(selector);
      if (element === null) return;
      observer = new ResizeObserver(refresh);
      observer.observe(element);
    };

    const measure = (): void => {
      if (disposed) return;
      const next = rectOf(selector);
      if (next === null) {
        if (performance.now() - startedAt < RETRY_BUDGET_MS) frame = requestAnimationFrame(measure);
        return;
      }
      setRect(next);
      observe();
    };

    const onResize = (): void => refresh();
    addEventListener("resize", onResize);
    frame = requestAnimationFrame(measure);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      removeEventListener("resize", onResize);
    };
  }, [anchor]);

  return rect;
}
