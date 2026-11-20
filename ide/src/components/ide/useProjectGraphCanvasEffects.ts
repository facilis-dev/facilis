// The canvas's instance-driven effects (extracted from ProjectGraphCanvas for the 300-line
// limit): the fit button, the AI focus fit, the add-note nonce, and the bottom-sheet reveal
// (issue #59). Each is an event or a guarded request, never a per-frame reaction.

import { useEffect, useRef, type RefObject } from "react";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";
import { toFlowPadding, type HudFitPadding } from "@/facilis/graph-hud-padding";
import { sheetPanOffset } from "@/facilis/graph-satellite";
import { cardFallbackSize } from "./ProjectGraphEdge";
import { DETAILS_NODE_TYPE } from "./ProjectGraphDetailsNode";
import type { ProjectCanvasEdge } from "./ProjectGraphDetailsLinkEdge";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

export interface SheetReveal {
  readonly height: number;
  readonly selectedNodeId: string | null;
}

export interface UseProjectGraphCanvasEffectsInput {
  instance: ReactFlowInstance<ProjectFlowNode, ProjectCanvasEdge> | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  fitNonce: number;
  fitPadding: HudFitPadding;
  focus: ProjectGraphFocusState | null;
  nodes: readonly ProjectFlowNode[];
  addNoteNonce: number;
  createNote: (position: { x: number; y: number }) => void;
  /** Non-null in sheet mode: the selected node must stay visible above the sheet. */
  sheet: SheetReveal | null;
}

export function useProjectGraphCanvasEffects({
  instance,
  wrapperRef,
  fitNonce,
  fitPadding,
  focus,
  nodes,
  addNoteNonce,
  createNote,
  sheet,
}: UseProjectGraphCanvasEffectsInput): void {
  // The fit button frames the graph, not the transient details satellite: at low zoom the
  // screen-constant satellite is huge in flow units and would drag the fit far out.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useEffect(() => {
    if (instance === null || fitNonce <= 0) return;
    const targets = nodesRef.current
      .filter((node) => node.type !== DETAILS_NODE_TYPE)
      .map((node) => ({ id: node.id }));
    void instance.fitView({ nodes: targets, padding: toFlowPadding(fitPadding), duration: 200 });
  }, [fitNonce, instance, fitPadding]);

  // A focus request names nodes that must exist in state before fitView can frame them, so the
  // effect waits for React Flow's instance and for the rebuilt node list. The ref keeps a drag
  // from refitting: `nodes` is a dependency only so a request made mid-build lands on a later
  // pass, not on every pointer move.
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

  // Adding a note is an event, not state: only a nonce change creates one, so a click made
  // while the canvas is not rendered cannot materialize a note on the next mount. The panel
  // only increments the nonce; the flow position of the viewport centre is computed here.
  const lastAddNonce = useRef(addNoteNonce);
  useEffect(() => {
    if (addNoteNonce === lastAddNonce.current || instance === null) return;
    const element = wrapperRef.current;
    if (element === null) return;
    lastAddNonce.current = addNoteNonce;
    const rect = element.getBoundingClientRect();
    createNote(
      instance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }),
    );
  }, [addNoteNonce, instance, createNote, wrapperRef]);

  // The sheet must not cover the selected node (issue #59): when it would, pan the viewport up
  // just enough. The key guards one reveal per selection/height/measurement, so the pan the
  // reveal itself causes cannot loop. The pan persists like any user pan (onMoveEnd saves it).
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (instance === null || sheet === null || sheet.selectedNodeId === null) return;
    const node = nodes.find((entry) => entry.id === sheet.selectedNodeId);
    const element = wrapperRef.current;
    if (node === undefined || element === null) return;
    const measured = node.measured?.height ?? cardFallbackSize(node.type).height;
    const key = sheet.selectedNodeId + ":" + sheet.height + ":" + measured;
    if (revealed.current === key) return;
    revealed.current = key;
    const viewport: Viewport = instance.getViewport();
    const bottom = (node.position.y + measured) * viewport.zoom + viewport.y;
    const offset = sheetPanOffset(bottom, element.clientHeight - sheet.height);
    if (offset === 0) return;
    void instance.setViewport(
      { x: viewport.x, y: viewport.y + offset, zoom: viewport.zoom },
      { duration: 200 },
    );
  }, [instance, sheet, nodes, wrapperRef]);
}