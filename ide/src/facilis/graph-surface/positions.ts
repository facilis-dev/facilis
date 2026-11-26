// Saved-position overrides and the dataset fingerprint for the map-and-lens surface
// (D-219, issue #185). Layout is cached per dataset: the fingerprint excludes the search query
// and the matched flags, so a keystroke never re-runs layout. Saved positions (D-126) pin a
// node's rect over the automatic swimlane placement, so adding/hiding a sibling cannot shift it,
// and a dropped node sticks where the user put it instead of snapping back (#145).

import { roundCoordinate, type GraphPosition } from "../graph-layout-file.ts";
import type { ProjectGraphView } from "../graph-types.ts";
import { boundsOf, type SurfaceRect } from "./layout.ts";
import type { DetailLayout } from "./detail.ts";

const FIELD = "\u0000";
const RECORD = "\u0001";
const SECTION = "\u0002";

/**
 * A fingerprint of everything the layout depends on — node identity, kind, label, source and
 * saved position, plus edge identity/kind/endpoints/access. The search query and the per-node
 * matched flag are deliberately absent: they dim cards but never move them, so the cached scene
 * survives a keystroke. Filtering edges or nodes changes the fingerprint (a new dataset).
 */
export function surfaceLayoutKey(view: ProjectGraphView): string {
  const nodes = view.nodes
    .map((node) =>
      [node.id, node.kind, node.label, node.sourceFile ?? "", node.position.x, node.position.y].join(
        FIELD,
      ),
    )
    .join(RECORD);
  const edges = view.edges
    .map((edge) => [edge.id, edge.kind, edge.source, edge.target, edge.access ?? ""].join(FIELD))
    .join(RECORD);
  return nodes + SECTION + edges;
}

export interface DetailWithPositions {
  readonly layout: DetailLayout;
  /** The automatic swimlane column x's (incl. workflow columns), sorted: the snap targets. */
  readonly columns: readonly number[];
}

/**
 * Override the automatic rects with the saved positions (D-126). Returns the same layout
 * instance when nothing is overridden, so a viewport-only state change cannot rebuild the scene.
 * The columns come from the AUTOMATIC placement, never the overrides, so a dragged node still
 * snaps back to a real lane column on its next drop.
 */
export function detailWithSavedPositions(
  auto: DetailLayout,
  saved: Readonly<Record<string, GraphPosition>>,
): DetailWithPositions {
  const columns = [...new Set([...auto.positions.values()].map((rect) => rect.x))].toSorted(
    (a, b) => a - b,
  );
  const positions = new Map(auto.positions);
  let changed = false;
  for (const [id, rect] of auto.positions) {
    const position = saved[id];
    if (position === undefined || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      continue;
    }
    if (position.x === rect.x && position.y === rect.y) continue;
    positions.set(id, { x: position.x, y: position.y, w: rect.w, h: rect.h });
    changed = true;
  }
  if (!changed) return { layout: auto, columns };
  const bounds = boundsOf([...positions.values(), ...auto.ports.map((port) => port.rect)]);
  return { layout: { ...auto, positions, bounds }, columns };
}

/**
 * Snap a dropped node to the nearest swimlane column so lanes stay separate; the dropped y is
 * kept (rounded to the persisted precision). With no columns the drop is kept as-is.
 */
export function snapDropToColumn(
  columns: readonly number[],
  dropX: number,
  dropY: number,
): GraphPosition {
  let best = columns[0];
  if (best === undefined) return { x: roundCoordinate(dropX), y: roundCoordinate(dropY) };
  for (const x of columns) {
    if (Math.abs(x - dropX) < Math.abs(best - dropX)) best = x;
  }
  return { x: roundCoordinate(best), y: roundCoordinate(dropY) };
}

/** Replace one node's rect in the working scene map: the live drag update (edges follow it). */
export function setNodeRect(
  positions: Map<string, SurfaceRect>,
  id: string,
  x: number,
  y: number,
): void {
  const rect = positions.get(id);
  if (rect === undefined) return;
  positions.set(id, { x, y, w: rect.w, h: rect.h });
}
