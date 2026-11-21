// The project graph's auto-layout engine (issue #61): pure placement behind one interface,
// layoutGraph(layers, pinnedPositions) -> positions + achieved size. Layers keep their semantic
// order (page -> route -> data -> workflow) but wrap into sub-columns once they outgrow a target
// height, serpentine so neighbouring sub-columns meet at short edges. The target height is chosen
// deterministically to bring the bounding box close to 16:9; saved positions stay absolute
// overrides, so .facilis/graph/ (v3) is untouched.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { GraphPosition } from "./graph-layout-file";
// The LOD-invariant card footprints (graph-node-size.ts) are the layout slots: one size source
// keeps the engine, the screenshot scene and the edge fallback in sync (epic #56 rule 4).
import { GRAPH_NODE_SIZES } from "./graph-node-size";

/** Vertical pitch per kind: the slot a row owns, tall enough for the kind's expanded card. */
export const GRAPH_ROW_PITCH: Readonly<Record<GraphNodeKind, number>> = {
  page: 200,
  route: 112,
  table: 190,
  view: 150,
  workflow: 150,
};

/** Blank space between the last table row and the first view row of the data layer. */
export const GRAPH_VIEW_GAP = 56;

const SUB_COLUMN_GAP = 64;
const LAYER_GAP = 96;
const TARGET_RATIO = 16 / 9;
const MIN_TARGET_HEIGHT = 320;
const MAX_TARGET_HEIGHT = 4000;
const TARGET_HEIGHT_STEP = 40;

export interface GraphLayoutRow {
  readonly id: string;
  readonly kind: GraphNodeKind;
  /** Extra blank space before this row (the data layer's table -> view separation). */
  readonly gapBefore?: number;
}

export interface GraphLayoutLayer {
  readonly rows: readonly GraphLayoutRow[];
}

export interface GraphLayoutResult {
  /** Auto positions with the finite pinned overrides applied; stale ids are ignored. */
  readonly positions: ReadonlyMap<string, GraphPosition>;
  /** Achieved bounding box of the auto layout (before overrides), in flow pixels. */
  readonly width: number;
  readonly height: number;
}

interface PlacedRow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface LayerPlacement {
  readonly rows: readonly PlacedRow[];
  readonly width: number;
}

function rowHeight(row: GraphLayoutRow): number {
  return GRAPH_ROW_PITCH[row.kind] + (row.gapBefore ?? 0);
}

/**
 * Wrap one layer into sub-columns of at most targetHeight (always at least one row). Even
 * sub-columns run top-down, odd ones mirror bottom-up, so the last row of a sub-column sits
 * beside the first row of the next: the serpentine keeps neighbour edges short.
 */
function placeLayer(
  layer: GraphLayoutLayer,
  targetHeight: number,
  originX: number,
): LayerPlacement {
  if (layer.rows.length === 0) return { rows: [], width: 0 };
  const slotWidth = Math.max(...layer.rows.map((row) => GRAPH_NODE_SIZES[row.kind].width));
  const columns: GraphLayoutRow[][] = [];
  let current: GraphLayoutRow[] = [];
  let used = 0;
  for (const row of layer.rows) {
    const height = rowHeight(row);
    if (current.length > 0 && used + height > targetHeight) {
      columns.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += height;
  }
  columns.push(current);

  const placed: PlacedRow[] = [];
  columns.forEach((rows, index) => {
    const columnHeight = rows.reduce((sum, row) => sum + rowHeight(row), 0);
    const x = originX + index * (slotWidth + SUB_COLUMN_GAP);
    let cursor = 0;
    for (const row of rows) {
      const size = GRAPH_NODE_SIZES[row.kind];
      const readingY = cursor + (row.gapBefore ?? 0);
      const y = index % 2 === 0 ? readingY : columnHeight - readingY - GRAPH_ROW_PITCH[row.kind];
      placed.push({ id: row.id, x, y, width: size.width, height: size.height });
      cursor = readingY + GRAPH_ROW_PITCH[row.kind];
    }
  });
  return {
    rows: placed,
    width: columns.length * slotWidth + (columns.length - 1) * SUB_COLUMN_GAP,
  };
}

function placeAll(layers: readonly GraphLayoutLayer[], targetHeight: number): PlacedRow[] {
  const placed: PlacedRow[] = [];
  let x = 0;
  for (const layer of layers) {
    const placement = placeLayer(layer, targetHeight, x);
    placed.push(...placement.rows);
    if (placement.width > 0) x += placement.width + LAYER_GAP;
  }
  return placed;
}

function bounds(rows: readonly PlacedRow[]): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const row of rows) {
    width = Math.max(width, row.x + row.width);
    height = Math.max(height, row.y + row.height);
  }
  return { width, height };
}

/**
 * Pick the target height whose wrapped bounding box sits closest to 16:9. The un-wrapped height
 * is a candidate too, so a small graph stays one column per layer instead of fragmenting.
 * Ties break on the smaller area, then the smaller target: same input, same output. Shared by
 * the row layers and the cluster boxes (issue #62) so both wrap under the same rule.
 */
function chooseWithTarget(
  natural: number,
  place: (targetHeight: number) => PlacedRow[],
): PlacedRow[] {
  const targets = [natural];
  for (let height = MIN_TARGET_HEIGHT; height <= MAX_TARGET_HEIGHT; height += TARGET_HEIGHT_STEP) {
    targets.push(height);
  }
  let best: PlacedRow[] = [];
  let bestScore = Number.POSITIVE_INFINITY;
  let bestArea = Number.POSITIVE_INFINITY;
  let bestTarget = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const rows = place(target);
    const { width, height } = bounds(rows);
    if (width === 0 || height === 0) return rows;
    const score = Math.abs(width / height - TARGET_RATIO);
    const area = width * height;
    if (
      score < bestScore - 1e-9 ||
      (Math.abs(score - bestScore) <= 1e-9 &&
        (area < bestArea || (area === bestArea && target < bestTarget)))
    ) {
      best = rows;
      bestScore = score;
      bestArea = area;
      bestTarget = target;
    }
  }
  return best;
}

function choosePlacement(layers: readonly GraphLayoutLayer[]): PlacedRow[] {
  const natural = Math.max(
    1,
    ...layers.map((layer) => layer.rows.reduce((sum, row) => sum + rowHeight(row), 0)),
  );
  return chooseWithTarget(natural, (target) => placeAll(layers, target));
}

/** Lay the ordered layers out; pinned positions override the auto ones for ids that exist. */
export function layoutGraph(
  layers: readonly GraphLayoutLayer[],
  pinnedPositions?: Readonly<Record<string, GraphPosition>>,
): GraphLayoutResult {
  const rows = choosePlacement(layers);
  const { width, height } = bounds(rows);
  const positions = new Map<string, GraphPosition>();
  for (const row of rows) positions.set(row.id, { x: row.x, y: row.y });
  if (pinnedPositions !== undefined) {
    for (const [id, position] of Object.entries(pinnedPositions)) {
      if (!positions.has(id)) continue;
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      positions.set(id, { x: position.x, y: position.y });
    }
  }
  return { positions, width, height };
}

/** A cluster frame or super-node box (issue #62): explicit size, no kind pitch. */
export interface GraphLayoutBox {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** Blank space between two cluster boxes stacked in one sub-column. */
const BOX_GAP = 72;

/**
 * Wrap variable-size boxes into serpentine sub-columns near 16:9, the cluster analogue of
 * placeLayer: each sub-column is as wide as its widest box, odd columns mirror bottom-up so
 * neighbouring clusters meet at short edges. Deterministic for a fixed box order.
 */
function placeBoxes(boxes: readonly GraphLayoutBox[], targetHeight: number): PlacedRow[] {
  if (boxes.length === 0) return [];
  const columns: GraphLayoutBox[][] = [];
  let current: GraphLayoutBox[] = [];
  let used = 0;
  for (const box of boxes) {
    const next = used === 0 ? box.height : used + BOX_GAP + box.height;
    if (current.length > 0 && next > targetHeight) {
      columns.push(current);
      current = [];
      used = 0;
    }
    current.push(box);
    used = used === 0 ? box.height : used + BOX_GAP + box.height;
  }
  if (current.length > 0) columns.push(current);
  const placed: PlacedRow[] = [];
  let x = 0;
  columns.forEach((column, index) => {
    const slotWidth = Math.max(...column.map((box) => box.width));
    const columnHeight =
      column.reduce((sum, box) => sum + box.height, 0) + BOX_GAP * (column.length - 1);
    let cursor = 0;
    for (const box of column) {
      const y = index % 2 === 0 ? cursor : columnHeight - cursor - box.height;
      placed.push({ id: box.id, x, y, width: box.width, height: box.height });
      cursor += box.height + BOX_GAP;
    }
    x += slotWidth + SUB_COLUMN_GAP;
  });
  return placed;
}

/** Lay cluster boxes out in order; the achieved bounds frame the whole clustered graph. */
export function layoutBoxes(boxes: readonly GraphLayoutBox[]): GraphLayoutResult {
  const natural = Math.max(
    1,
    boxes.reduce((sum, box) => sum + box.height, 0) + BOX_GAP * Math.max(0, boxes.length - 1),
  );
  const rows = chooseWithTarget(natural, (target) => placeBoxes(boxes, target));
  const { width, height } = bounds(rows);
  const positions = new Map<string, GraphPosition>();
  for (const row of rows) positions.set(row.id, { x: row.x, y: row.y });
  return { positions, width, height };
}
