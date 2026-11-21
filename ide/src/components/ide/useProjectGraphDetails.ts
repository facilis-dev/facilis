// The details satellite's session state and the canvas's combined node list (issue #59): the
// analysis cards, notes, hub chips and details nodes in one list, kept attached while the anchor
// drags or the viewport moves. The panel owns the pins; nothing here is persisted.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyNodeChanges, type OnNodesChange, type Viewport } from "@xyflow/react";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { PinnedDetailsCard } from "@/facilis/graph-satellite";
import type { GraphNote } from "@/facilis/graph-types";
import { focusGraphNode } from "./focus-graph-node";
import {
  buildDetailsFlowNodes,
  pinPositionOf,
  repositionDetailsNode,
} from "./project-graph-details-nodes";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";
import { buildHubFlowNodes } from "./project-graph-hub-flow";
import type { UseProjectGraphDetailsInput } from "./project-graph-details-input";
import type { ProjectFlowNode } from "./ProjectGraphNodes";

export type { PinRequest } from "./project-graph-details-input";

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

export function useProjectGraphDetails({
  view,
  notes,
  focus,
  userFocus,
  isolatedEdgeKinds,
  contract,
  data,
  turn,
  drill,
  hubs,
  selectedNodeId,
  sheetMode,
  pinned,
  dispatchPinned,
  pinRequest,
  details,
  sources,
  nodeLabel,
  instance,
  wrapperRef,
  containerWidth,
  onSelectNode,
  onOpenFileAt,
  onOpenPreview,
  onToggleCollapse,
  onToggleClusterCollapse,
  onEditNote,
  onDeleteNote,
}: UseProjectGraphDetailsInput) {
  // Inline callbacks change identity every render; refs keep the cards' data stable mid-drag.
  const callbacks = useRef({ onSelectNode, onOpenFileAt, onOpenPreview, nodeLabel });
  callbacks.current = { onSelectNode, onOpenFileAt, onOpenPreview, nodeLabel };
  const selectNode = useCallback((id: string | null) => callbacks.current.onSelectNode(id), []);
  const openFileAt = useCallback(
    (file: string, line: number) => callbacks.current.onOpenFileAt(file, line),
    [],
  );
  const openPreview = useCallback((path: string) => callbacks.current.onOpenPreview(path), []);
  const labelOf = useCallback((id: string) => callbacks.current.nodeLabel(id), []);

  const selectedNode = useMemo(
    () => view.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [view, selectedNodeId],
  );
  // A pinned node shows its card, not a second satellite; the sheet replaces the satellite.
  const activeAnchorId =
    sheetMode || selectedNode === null || pinned.some((card) => card.nodeId === selectedNode.id)
      ? null
      : selectedNode.id;

  const closeActive = useCallback(() => {
    if (activeAnchorId !== null) focusGraphNode(activeAnchorId);
    selectNode(null);
  }, [activeAnchorId, selectNode]);
  const closePinned = useCallback(
    (card: PinnedDetailsCard) => {
      focusGraphNode(card.nodeId);
      dispatchPinned({ type: "unpin", id: card.id });
    },
    [dispatchPinned],
  );

  const nodesRef = useRef<ProjectFlowNode[]>([]);
  const instanceRef = useRef(instance);
  instanceRef.current = instance;
  // Pinning keeps the card where the satellite sits; from the sheet it lands at the centre.
  const resolvePinPosition = useCallback(
    (nodeId: string) =>
      pinPositionOf(nodesRef.current, instanceRef.current, wrapperRef.current, nodeId),
    [wrapperRef],
  );
  const togglePin = useCallback(
    (nodeId: string) => {
      const card = pinned.find((entry) => entry.nodeId === nodeId);
      if (card !== undefined) {
        closePinned(card);
        return;
      }
      const position = resolvePinPosition(nodeId);
      if (position !== null) dispatchPinned({ type: "pin", nodeId, position });
    },
    [pinned, closePinned, resolvePinPosition, dispatchPinned],
  );
  const movePinned = useCallback(
    (id: string, position: { x: number; y: number }) => {
      dispatchPinned({ type: "move", id, position });
    },
    [dispatchPinned],
  );

  // The sheet's pin button is an event: only a nonce change pins, so a re-render cannot repeat.
  const lastPinNonce = useRef(pinRequest?.nonce ?? 0);
  useEffect(() => {
    if (pinRequest === null || pinRequest.nonce === lastPinNonce.current) return;
    lastPinNonce.current = pinRequest.nonce;
    togglePin(pinRequest.nodeId);
  }, [pinRequest, togglePin]);

  const buildNodes = useCallback(
    (
      next: ProjectGraphView,
      nextNotes: readonly GraphNote[],
      previous: readonly ProjectFlowNode[],
    ) => {
      const base = buildProjectGraphFlowNodes({
        view: next,
        notes: nextNotes,
        previous,
        selectedNodeId,
        focus,
        userFocus,
        isolatedEdgeKinds,
        contract,
        data,
        turn,
        drill,
        hubIsolation: hubs.isolation,
        onToggleCollapse,
        onToggleClusterCollapse,
        onEditNote,
        onDeleteNote,
      });
      const viewport = instanceRef.current?.getViewport() ?? DEFAULT_VIEWPORT;
      return [
        ...base,
        // Hub chips are view artefacts (issue #64): fixed-size, non-draggable, never persisted.
        ...buildHubFlowNodes(hubs, next, { focus, userFocus, isolatedEdgeKinds, drill }),
        ...buildDetailsFlowNodes({
          view: next,
          analysisNodes: base,
          previous,
          pinned,
          activeAnchorId,
          viewport,
          containerWidth,
          details,
          nodeDiagnostics: contract.nodeDiagnostics,
          sources,
          nodeLabel: labelOf,
          onCloseActive: closeActive,
          onClosePinned: closePinned,
          onTogglePin: togglePin,
          onOpenFileAt: openFileAt,
          onOpenPreview: openPreview,
          onSelectNode: selectNode,
        }),
      ];
    },
    [
      selectedNodeId,
      focus,
      userFocus,
      isolatedEdgeKinds,
      contract,
      data,
      turn,
      drill,
      hubs,
      onToggleCollapse,
      onToggleClusterCollapse,
      onEditNote,
      onDeleteNote,
      pinned,
      activeAnchorId,
      details,
      sources,
      labelOf,
      closeActive,
      closePinned,
      togglePin,
      openFileAt,
      openPreview,
      selectNode,
      wrapperRef,
      containerWidth,
      instance,
    ],
  );

  // Lazy init so the first paint already has the cards: the boot fitView must see them.
  const [nodes, setNodes] = useState<ProjectFlowNode[]>(() => buildNodes(view, notes, []));
  nodesRef.current = nodes;

  // The view is the saved layout plus the analysis; re-sync on every change but keep a drag.
  useEffect(() => {
    setNodes((current) => buildNodes(view, notes, current));
  }, [view, notes, buildNodes]);

  const onNodesChange: OnNodesChange<ProjectFlowNode> = useCallback(
    (changes) => {
      setNodes((current) =>
        repositionDetailsNode(
          applyNodeChanges(changes, current),
          activeAnchorId,
          instanceRef.current?.getViewport() ?? DEFAULT_VIEWPORT,
          containerWidth,
        ),
      );
    },
    [activeAnchorId, containerWidth],
  );
  // A pan or zoom may flip the side; the viewport comes from the move event itself.
  const onViewportMove = useCallback(
    (viewport: Viewport) => {
      setNodes((current) =>
        repositionDetailsNode(current, activeAnchorId, viewport, containerWidth),
      );
    },
    [activeAnchorId, containerWidth],
  );

  return { nodes, onNodesChange, onViewportMove, activeAnchorId, movePinned };
}
