// The project graph in fullscreen (issue #217): a covering layer that lives inside the
// workspace frame, so it has to leave the frame's subtree before the frame goes inert. The
// hook owns the state, the layer registration, the section props that make the panel the
// layer, and the focus handoff; the panel keeps its markup.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode, RefObject } from "react";
import { useBlockingLayer } from "./use-blocking-layer";

export interface ProjectGraphFullscreen {
  fullscreen: boolean;
  toggleFullscreen: () => void;
  exitFullscreen: () => void;
  /** Ref, tabIndex and the overlay marker: the section is a layer only while fullscreen. */
  layerProps: {
    ref: RefObject<HTMLElement | null>;
    tabIndex: number | undefined;
    "data-blocking-overlay": "" | undefined;
  };
}

export function useProjectGraphFullscreen(): ProjectGraphFullscreen {
  const sectionRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const wasFullscreen = useRef(false);
  // The frame inerts behind every registered layer, but the section is portaled out of it
  // while fullscreen, so the cover does not cover the graph itself.
  useBlockingLayer("project-graph-fullscreen", fullscreen);
  useLayoutEffect(() => {
    if (fullscreen) {
      wasFullscreen.current = true;
      sectionRef.current?.focus();
      return;
    }
    if (!wasFullscreen.current) return;
    wasFullscreen.current = false;
    // The layer unregisters after this commit, so the frame (and the section it contains
    // again) is focusable only from the next frame on.
    const frame = requestAnimationFrame(() => {
      sectionRef.current?.querySelector<HTMLElement>("[data-graph-fullscreen-toggle]")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [fullscreen]);
  const toggleFullscreen = useCallback(() => setFullscreen((value) => !value), []);
  const exitFullscreen = useCallback(() => setFullscreen(false), []);
  return {
    fullscreen,
    toggleFullscreen,
    exitFullscreen,
    layerProps: {
      ref: sectionRef,
      tabIndex: fullscreen ? -1 : undefined,
      "data-blocking-overlay": fullscreen ? "" : undefined,
    },
  };
}

/** Render the panel in place, or over the whole document while it is fullscreen. */
export function portalWhenFullscreen(fullscreen: boolean, content: ReactNode): ReactNode {
  return fullscreen ? createPortal(content, document.body) : content;
}
