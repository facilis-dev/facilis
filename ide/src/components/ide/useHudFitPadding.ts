// Measures the floating HUD clusters and turns them into fitView padding (issue #57). The pure
// math lives in graph-hud-padding.ts; this hook only reads DOM rects relative to the canvas
// container and recomputes when the container or a cluster resizes, or when zen hides the HUD.
// The panel also calls remeasure() right before an explicit fit so a just-changed cluster (save
// state text, a appearing badge) is accounted for even if no resize event fired.

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import {
  computeHudFitPadding,
  type HudFitPadding,
  type HudRect,
} from "@/facilis/graph-hud-padding";

const IDLE: HudFitPadding = { top: 16, right: 16, bottom: 16, left: 16 };

export function useHudFitPadding(
  containerRef: RefObject<HTMLDivElement | null>,
  /** False in zen (or before the canvas exists): no cluster is measured, so the fit keeps a gap. */
  active: boolean,
): { readonly padding: HudFitPadding; readonly remeasure: () => void } {
  const [padding, setPadding] = useState<HudFitPadding>(IDLE);
  const remeasure = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    const base = container.getBoundingClientRect();
    const zones: HudRect[] = [];
    if (active) {
      for (const element of container.querySelectorAll<HTMLElement>("[data-hud-zone]")) {
        const rect = element.getBoundingClientRect();
        zones.push({
          x: rect.left - base.left,
          y: rect.top - base.top,
          width: rect.width,
          height: rect.height,
        });
      }
    }
    setPadding(computeHudFitPadding({ width: base.width, height: base.height }, zones));
  }, [containerRef, active]);

  useLayoutEffect(() => {
    // Layout effect, not passive: the padding must be current before React Flow's init fit runs.
    remeasure();
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(() => remeasure());
    observer.observe(container);
    if (active) {
      for (const element of container.querySelectorAll<HTMLElement>("[data-hud-zone]")) {
        observer.observe(element);
      }
    }
    return () => observer.disconnect();
  }, [remeasure, containerRef, active]);

  return { padding, remeasure };
}
