// The rects the orthogonal edge router avoids (issue #61), extracted from ProjectGraphEdge so
// the component keeps only the React wiring (the 300-line source limit). One rect list per
// nodeLookup identity, shared by every edge: a drag or a viewport tick must not rebuild N rects
// per edge. The lookup is replaced whenever nodes change, so the cache cannot serve stale
// geometry. Satellite and pinned details cards are nodes in the lookup too, so analysis edges
// never route across an open details card. Cluster frames (issue #62) are containers, not
// obstacles: edges between their children route inside them; a collapsed super-node is a card
// again and routes around it.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import { nodeRect, type Point, type Rect } from "@/facilis/graph-edge-geometry";
import { GRAPH_NODE_SIZES } from "@/facilis/graph-node-size";
import { CLUSTER_NODE_TYPE } from "./ProjectGraphClusterNode";

/** The structural shape a rect needs: an endpoint hook result or a nodeLookup entry. */
export interface MeasuredNode {
  readonly type?: string;
  readonly internals: { readonly positionAbsolute: Point };
  readonly measured?: { readonly width?: number; readonly height?: number };
  readonly width?: number;
  readonly height?: number;
  readonly data?: unknown;
}

/** The shared full-card footprints (graph-node-size.ts), used before React Flow measures. */
const DEFAULT_SIZE = { width: 220, height: 48 };

/** Card sizes before measurement; shared with the satellite placement (issue #59). */
export function cardFallbackSize(type: string | undefined): {
  readonly width: number;
  readonly height: number;
} {
  // The node type is the kind string for analysis cards; notes fall back to the default.
  if (type !== undefined && type in GRAPH_NODE_SIZES)
    return GRAPH_NODE_SIZES[type as GraphNodeKind];
  return DEFAULT_SIZE;
}

/** The card rect edges anchor to; shared with the cubic details connector (#59, F.1). */
export function internalNodeRect(node: MeasuredNode | undefined): Rect | null {
  if (node === undefined) return null;
  const fallback = cardFallbackSize(node.type);
  return nodeRect(
    node.internals.positionAbsolute,
    node.measured?.width ?? node.width ?? fallback.width,
    node.measured?.height ?? node.height ?? fallback.height,
  );
}

/** The cluster fact a frame node carries, narrowed from the unknown React Flow data. */
function clusterFact(
  node: MeasuredNode,
): { collapsed: boolean; size: { width: number; height: number } | null } | null {
  const data: unknown = node.data;
  if (typeof data !== "object" || data === null || !("cluster" in data)) return null;
  const raw: unknown = (data as { cluster: unknown }).cluster;
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const sizeRaw: unknown = record.size;
  let size: { width: number; height: number } | null = null;
  if (typeof sizeRaw === "object" && sizeRaw !== null) {
    const box = sizeRaw as Record<string, unknown>;
    if (typeof box.width === "number" && typeof box.height === "number") {
      size = { width: box.width, height: box.height };
    }
  }
  return { collapsed: record.collapsed === true, size };
}

const obstacleCache = new WeakMap<object, readonly Rect[]>();

export function obstacleRects(nodeLookup: ReadonlyMap<string, MeasuredNode>): readonly Rect[] {
  const cached = obstacleCache.get(nodeLookup);
  if (cached !== undefined) return cached;
  const rects: Rect[] = [];
  for (const node of nodeLookup.values()) {
    if (node.type === CLUSTER_NODE_TYPE) {
      const cluster = clusterFact(node);
      // An expanded frame is a container: edges between its children route inside it.
      if (cluster === null || !cluster.collapsed) continue;
      rects.push(
        nodeRect(
          node.internals.positionAbsolute,
          node.measured?.width ?? node.width ?? cluster.size?.width ?? DEFAULT_SIZE.width,
          node.measured?.height ?? node.height ?? cluster.size?.height ?? DEFAULT_SIZE.height,
        ),
      );
      continue;
    }
    const rect = internalNodeRect(node);
    if (rect !== null) rects.push(rect);
  }
  obstacleCache.set(nodeLookup, rects);
  return rects;
}
