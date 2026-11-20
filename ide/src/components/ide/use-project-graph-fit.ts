// The canvas's viewport effects (issue #57), split from ProjectGraphCanvas so the canvas
// stays under the source limit: the fit button, the AI focus zoom (D-171), the HUD zoom
// buttons, and the initial auto-fit while no viewport is saved.
//
// Every fit pads with the measured HUD rectangles so no node lands under a cluster. The
// padding travels through a ref: a resize must update future fits, never refit a viewport
// the user already chose (spatial constancy).

import { useEffect, useRef } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { flowPadding, type FitPadding } from "./graph-hud-padding";
import type { ProjectFlowEdge } from "./ProjectGraphEdge";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

/** A HUD zoom button press: an event, not state, so only a nonce change zooms. */
export interface GraphZoomRequest {
  readonly nonce: number;
  readonly direction: "in" | "out";
}

export function useProjectGraphFit(
  instance: ReactFlowInstance<ProjectFlowNode, ProjectFlowEdge> | null,
  options: {
    readonly fitNonce: number;
    readonly fitPadding: FitPadding;
    readonly focus: ProjectGraphFocusState | null;
    readonly nodes: readonly ProjectFlowNode[];
    readonly zoomRequest: GraphZoomRequest | null;
    /** True while the layout has no saved viewport: the graph auto-fits on mount. */
    readonly autoFit: boolean;
  },
): void {
  const { fitNonce, fitPadding, focus, nodes, zoomRequest, autoFit } = options;
  const paddingRef = useRef(fitPadding);
  useEffect(() => {
    paddingRef.current = fitPadding;
  }, [fitPadding]);

  // The fit button and reset-layout: only an explicit request refits, so a refresh does not
  // throw away a saved viewport.
  useEffect(() => {
    if (instance === null || fitNonce <= 0) return;
    void instance.fitView({ padding: flowPadding(paddingRef.current), duration: 200 });
  }, [fitNonce, instance]);

  // The initial fit waits for the measured padding: the shell measures the HUD in a layout
  // effect before React Flow's instance exists, so the first fit already clears the clusters.
  useEffect(() => {
    if (instance === null || !autoFit) return;
    void instance.fitView({ padding: flowPadding(fitPadding), duration: 0 });
  }, [autoFit, instance, fitPadding]);

  // A focus request names nodes that must exist in state before fitView can frame them, so
  // the effect waits for the instance and the rebuilt node list. The ref keeps a drag from
  // refitting: `nodes` is a dependency only so a request made mid-build lands on a later pass.
  const fittedFocus = useRef<ProjectGraphFocusState | null>(null);
  useEffect(() => {
    if (instance === null || focus === null || !focus.zoom) return;
    if (fittedFocus.current === focus) return;
    const targets = nodes
      .filter((node) => focus.nodeIds.has(node.id))
      .map((node) => ({ id: node.id }));
    if (targets.length === 0) return;
    fittedFocus.current = focus;
    void instance.fitView({
      nodes: targets,
      padding: flowPadding(paddingRef.current),
      duration: 200,
    });
  }, [focus, instance, nodes]);

  const lastZoomNonce = useRef(0);
  useEffect(() => {
    if (instance === null || zoomRequest === null) return;
    if (zoomRequest.nonce === lastZoomNonce.current) return;
    lastZoomNonce.current = zoomRequest.nonce;
    if (zoomRequest.direction === "in") void instance.zoomIn({ duration: 150 });
    else void instance.zoomOut({ duration: 150 });
  }, [zoomRequest, instance]);
}
