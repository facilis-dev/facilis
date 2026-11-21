// Card rects for the project-graph edge geometry (issues #61/#65): the React edge reads them
// from React Flow's internal node lookup, the canvas bridge planner from the controlled node
// list. Both share this module so the planner and the per-edge router see the same cards,
// including the pre-measurement fallback sizes and the note cards.

import { nodeRect, type Point, type Rect } from "@/facilis/graph-edge-geometry";
import { GRAPH_CARD_SIZES } from "@/facilis/graph-layout-engine";
import type { ProjectFlowNode } from "./ProjectGraphNodes";

/** The structural shape rectFor needs: an endpoint hook result or a nodeLookup entry. */
export interface MeasuredNode {
  readonly type?: string;
  readonly internals: { readonly positionAbsolute: Point };
  readonly measured?: { readonly width?: number; readonly height?: number };
  readonly width?: number;
  readonly height?: number;
}

/** Card sizes before React Flow reports a measurement; the engine's sizes are the fallback. */
const DEFAULT_SIZE = { width: 220, height: 48 };

export function fallbackSize(type: string | undefined): {
  readonly width: number;
  readonly height: number;
} {
  if (type === undefined) return DEFAULT_SIZE;
  return GRAPH_CARD_SIZES[type as keyof typeof GRAPH_CARD_SIZES] ?? DEFAULT_SIZE;
}

export function rectFor(node: MeasuredNode | undefined): Rect | null {
  if (node === undefined) return null;
  const fallback = fallbackSize(node.type);
  return nodeRect(
    node.internals.positionAbsolute,
    node.measured?.width ?? node.width ?? fallback.width,
    node.measured?.height ?? node.height ?? fallback.height,
  );
}

/**
 * One rect list per nodeLookup identity, shared by every edge: a drag or a viewport tick must
 * not rebuild N rects per edge. The lookup is replaced whenever nodes change, so the cache
 * cannot serve stale geometry.
 */
const obstacleCache = new WeakMap<object, readonly Rect[]>();

export function obstacleRects(nodeLookup: ReadonlyMap<string, MeasuredNode>): readonly Rect[] {
  const cached = obstacleCache.get(nodeLookup);
  if (cached !== undefined) return cached;
  const rects: Rect[] = [];
  for (const node of nodeLookup.values()) {
    const rect = rectFor(node);
    if (rect !== null) rects.push(rect);
  }
  obstacleCache.set(nodeLookup, rects);
  return rects;
}

/**
 * The same rects keyed by id from the controlled node list: the canvas plans bridges with
 * these, so a drag (which updates positions live) replans against the moving cards.
 */
export function flowNodeRects(nodes: readonly ProjectFlowNode[]): ReadonlyMap<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const node of nodes) {
    const fallback = fallbackSize(node.type);
    rects.set(
      node.id,
      nodeRect(
        node.position,
        node.measured?.width ?? node.width ?? fallback.width,
        node.measured?.height ?? node.height ?? fallback.height,
      ),
    );
  }
  return rects;
}
