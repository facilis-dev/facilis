// The canvas's session-scoped hub state (issue #64): which hubs are expanded and which one
// is hovered. Deliberately NOT URL state and NOT persisted — a reload re-concentrates every
// fan-out, while the threshold itself lives in the addressable view state (#58). The overlay
// and the hover isolation are pure derivations (graph-edge-hubs.ts), memoized per view.

import { useCallback, useMemo, useState } from "react";
import {
  deriveEdgeHubOverlay,
  hubIsolation,
  toggleExpandedHub,
  type GraphHubOverlay,
  type HubIsolation,
} from "@/facilis/graph-edge-hubs";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphEdgeConcentration } from "@/facilis/graph-view-state";

export interface ProjectGraphHubsState {
  readonly overlay: GraphHubOverlay;
  readonly isolation: HubIsolation | null;
  /** The hovered hub id, or null when the hover is stale (its hub just collapsed/changed). */
  readonly activeHover: string | null;
  readonly toggleHub: (hubId: string) => void;
  readonly hoverHub: (hubId: string | null) => void;
}

export function useProjectGraphHubs(
  view: ProjectGraphView,
  concentration: GraphEdgeConcentration,
): ProjectGraphHubsState {
  const [expandedHubs, setExpandedHubs] = useState<ReadonlySet<string>>(() => new Set());
  const [hoveredHubId, setHoveredHubId] = useState<string | null>(null);
  const overlay = useMemo(
    () => deriveEdgeHubOverlay(view, concentration, expandedHubs),
    [view, concentration, expandedHubs],
  );
  // A hover can outlive its hub (threshold change, re-analysis): treat a stale id as no hover.
  const activeHover =
    hoveredHubId !== null && overlay.hubs.some((hub) => hub.id === hoveredHubId)
      ? hoveredHubId
      : null;
  const isolation = useMemo(() => hubIsolation(overlay, activeHover), [overlay, activeHover]);
  const toggleHub = useCallback((hubId: string) => {
    setExpandedHubs((current) => toggleExpandedHub(current, hubId));
  }, []);
  const hoverHub = useCallback((hubId: string | null) => {
    setHoveredHubId(hubId);
  }, []);
  return { overlay, isolation, activeHover, toggleHub, hoverHub };
}
