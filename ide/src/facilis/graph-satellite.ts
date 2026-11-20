// Pure geometry and session state for the in-canvas details satellite (issue #59, epic #56):
// where the satellite sits beside its anchor card, when it flips side, and the pinned cards a
// session keeps for comparing two nodes. No React and no DOM here, so every rule is unit-tested.
// The satellite is screen-constant: its flow size is divided by the zoom, so its text never
// shrinks below the readable threshold (epic design rule 4) while pan/zoom keep it attached.

import type { Point } from "./graph-edge-geometry";

/** Screen px between the anchor card and the satellite. */
export const SATELLITE_GAP = 24;
/** Screen px the satellite occupies, at every zoom. */
export const SATELLITE_WIDTH = 320;
export const SATELLITE_HEIGHT = 420;
/** Screen px the satellite keeps from the canvas border when choosing a side. */
export const SATELLITE_EDGE_MARGIN = 16;

/** Below this container width the details render as a bottom sheet, not a satellite. */
export const SHEET_BREAKPOINT = 1200;
export const SHEET_MIN_HEIGHT = 160;
export const SHEET_DEFAULT_HEIGHT = 280;
/** The sheet never takes more than this fraction of the canvas height. */
export const SHEET_MAX_HEIGHT_RATIO = 0.6;
/** Screen px the selected node keeps above the sheet when the viewport pans to reveal it. */
export const SHEET_NODE_CLEARANCE = 16;

export type SatelliteSide = "right" | "left";

/** The anchor card in flow coordinates: its top-left corner plus its measured width. */
export interface SatelliteAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface SatelliteViewport {
  readonly x: number;
  readonly zoom: number;
}

export function satelliteNodeId(anchorId: string): string {
  return "details:" + anchorId;
}

export function detailsLinkEdgeId(anchorId: string): string {
  return "details-link:" + anchorId;
}

/**
 * Prefer the right of the anchor; flip left when the satellite would leave the viewport. When
 * neither side fits (a very narrow canvas or a card wider than it), keep the side with more
 * room so the card clips as little as possible. All comparisons are in screen pixels.
 */
export function satelliteSide(
  anchor: SatelliteAnchor,
  viewport: SatelliteViewport,
  containerWidth: number,
): SatelliteSide {
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  const screenLeft = anchor.x * zoom + viewport.x;
  const screenRight = (anchor.x + anchor.width) * zoom + viewport.x;
  const needed = SATELLITE_GAP + SATELLITE_WIDTH + SATELLITE_EDGE_MARGIN;
  if (screenRight + needed <= containerWidth - SATELLITE_EDGE_MARGIN) return "right";
  if (screenLeft - needed >= SATELLITE_EDGE_MARGIN) return "left";
  return containerWidth - screenRight >= screenLeft ? "right" : "left";
}

/** The satellite's top-left in flow coordinates; the gap and width are screen-constant. */
export function satellitePosition(
  anchor: SatelliteAnchor,
  side: SatelliteSide,
  zoom: number,
): Point {
  const scale = zoom > 0 ? zoom : 1;
  const gap = SATELLITE_GAP / scale;
  const width = SATELLITE_WIDTH / scale;
  return side === "right"
    ? { x: anchor.x + anchor.width + gap, y: anchor.y }
    : { x: anchor.x - gap - width, y: anchor.y };
}

/** A details card pinned free-floating on the canvas; session-scoped, never saved (issue #59). */
export interface PinnedDetailsCard {
  readonly id: string;
  readonly nodeId: string;
  readonly position: Point;
}

export type PinnedDetailsAction =
  | { readonly type: "pin"; readonly nodeId: string; readonly position: Point }
  | { readonly type: "unpin"; readonly id: string }
  | { readonly type: "move"; readonly id: string; readonly position: Point }
  | { readonly type: "prune"; readonly knownNodeIds: ReadonlySet<string> };

export const INITIAL_PINNED_DETAILS: readonly PinnedDetailsCard[] = [];

/**
 * Pinning is idempotent per node: the pinned card reuses the satellite's id, so a node is never
 * drawn twice. Unpinning removes the card; pruning drops cards whose node left the analysis.
 */
export function pinnedDetailsReducer(
  state: readonly PinnedDetailsCard[],
  action: PinnedDetailsAction,
): readonly PinnedDetailsCard[] {
  switch (action.type) {
    case "pin": {
      if (state.some((card) => card.nodeId === action.nodeId)) return state;
      return [
        ...state,
        { id: satelliteNodeId(action.nodeId), nodeId: action.nodeId, position: action.position },
      ];
    }
    case "unpin": {
      const next = state.filter((card) => card.id !== action.id);
      return next.length === state.length ? state : next;
    }
    case "move": {
      if (!state.some((card) => card.id === action.id)) return state;
      return state.map((card) =>
        card.id === action.id ? { ...card, position: action.position } : card,
      );
    }
    case "prune": {
      const next = state.filter((card) => action.knownNodeIds.has(card.nodeId));
      return next.length === state.length ? state : next;
    }
  }
}

/** The sheet height a drag may ask for, clamped to the canvas it covers. */
export function clampSheetHeight(height: number, containerHeight: number): number {
  const max = Math.max(SHEET_MIN_HEIGHT, Math.floor(containerHeight * SHEET_MAX_HEIGHT_RATIO));
  return Math.min(Math.max(Math.round(height), SHEET_MIN_HEIGHT), max);
}

/** How far (screen px, <= 0) the viewport must pan up so the node clears the sheet. */
export function sheetPanOffset(nodeScreenBottom: number, sheetTop: number): number {
  const overlap = nodeScreenBottom + SHEET_NODE_CLEARANCE - sheetTop;
  return overlap > 0 ? -overlap : 0;
}
