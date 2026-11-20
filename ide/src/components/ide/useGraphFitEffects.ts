// The canvas's programmatic fits (extracted from ProjectGraphCanvas for the 300-line limit):
// an AI focus (D-171) frames the nodes it names, and a drill-down (issue #62) frames the
// cluster frame plus its members. Both wait for the React Flow instance and for the rebuilt
// node list so a request made mid-build lands on a later pass; the refs keep a drag or a
// viewport tick from refitting, and each request fits exactly once.

import { useEffect, useRef } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlowPadding, type HudFitPadding } from "@/facilis/graph-hud-padding";
import type { ProjectFlowEdge } from "./ProjectGraphEdge";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import type { ProjectGraphDrill } from "./project-graph-flow-nodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export function useGraphFitEffects(
  instance: ReactFlowInstance<ProjectFlowNode, ProjectFlowEdge> | null,
  nodes: readonly ProjectFlowNode[],
  focus: ProjectGraphFocusState | null,
  drill: ProjectGraphDrill | null,
  fitPadding: HudFitPadding,
): void {
  const fittedFocus = useRef<ProjectGraphFocusState | null>(null);
  useEffect(() => {
    if (instance === null || focus === null || !focus.zoom) return;
    if (fittedFocus.current === focus) return;
    const targets = nodes
      .filter((node) => focus.nodeIds.has(node.id))
      .map((node) => ({ id: node.id }));
    if (targets.length === 0) return;
    fittedFocus.current = focus;
    void instance.fitView({ nodes: targets, padding: toFlowPadding(fitPadding), duration: 200 });
  }, [focus, instance, nodes, fitPadding]);

  const fittedDrill = useRef<string | null>(null);
  useEffect(() => {
    if (instance === null || drill === null) {
      fittedDrill.current = null;
      return;
    }
    if (fittedDrill.current === drill.clusterId) return;
    const targets = nodes
      .filter((node) => node.id === drill.clusterId || drill.nodeIds.has(node.id))
      .map((node) => ({ id: node.id }));
    if (targets.length === 0) return;
    fittedDrill.current = drill.clusterId;
    void instance.fitView({ nodes: targets, padding: toFlowPadding(fitPadding), duration: 200 });
  }, [drill, instance, nodes, fitPadding]);
}
