// The standalone picture of the visible project graph that graph_screenshot renders (D-171).
//
// Pure: the visible view model plus the committed layout go in, a deterministic scene comes out
// (card rects with labels, edge paths, canvas size). React Flow measures cards in the DOM; an
// off-DOM tool cannot, so the sizes here are the card classes' fixed width plus the deterministic
// heights the edge geometry already falls back to. The browser-only raster module paints the
// scene; keeping geometry out of it is what makes this testable in Node.

import type { GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { planGraphBridges } from "./graph-edge-bridges";
import { bridgeGeometry, shiftBridgeSpec, type BridgeSpec } from "./graph-bridge-geometry";
import {
  edgeGeometry,
  nodeRect,
  selfLoopGeometry,
  type Point,
  type Rect,
} from "./graph-edge-geometry";
import { bridgeApexLabel } from "./graph-edge-labels";
import { routeEdge } from "./graph-edge-routing";
import { GRAPH_CARD_SIZES } from "./graph-layout-engine";
import type { GraphLayoutFile } from "./graph-layout-file";
import type { ProjectGraphEdge, ProjectGraphNode, ProjectGraphView } from "./graph-types";

/** The engine's card sizes are the scene's sizes: one source of truth keeps the two in sync. */
const CARD_SIZES = GRAPH_CARD_SIZES;

/** Blank space around the drawing (self-loops bulge ~62 px out of a card). */
const SCENE_PADDING = 72;

/** Room above/below an apex for its label, on top of the scene padding (issue #65). */
const BRIDGE_LABEL_MARGIN = 18;

/** Caps keep one screenshot readable and bounded: a 1,000-card picture is not an inspection. */
export const MAX_SCENE_NODES = 200;
export const MAX_SCENE_EDGES = 600;

export interface GraphSceneEdgeStyle {
  readonly stroke: string;
  readonly dashed: boolean;
}

/** Colours are passed in so the scene stays DOM-free; the access layer resolves the theme vars. */
export interface GraphScenePalette {
  readonly background: string;
  readonly card: string;
  readonly border: string;
  readonly text: string;
  readonly muted: string;
  readonly edges: Readonly<Record<GraphEdgeKind, GraphSceneEdgeStyle>>;
  readonly elevated: GraphSceneEdgeStyle;
}

export interface GraphSceneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GraphSceneNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly rect: GraphSceneRect;
}

export interface GraphSceneEdge {
  readonly id: string;
  readonly path: string;
  readonly stroke: string;
  readonly dashed: boolean;
  /** Present when the edge is a bridge: the apex and its label, as the canvas draws them. */
  readonly bridge?: { readonly apex: Point; readonly label: string };
}

export interface GraphScene {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly GraphSceneNode[];
  readonly edges: readonly GraphSceneEdge[];
  /** True when a cap dropped nodes or edges from the picture. */
  readonly truncated: boolean;
}

function byId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id);
}

function edgeStyleOf(edge: ProjectGraphEdge, palette: GraphScenePalette): GraphSceneEdgeStyle {
  return edge.access === "elevated" ? palette.elevated : palette.edges[edge.kind];
}

function rectFor(node: ProjectGraphNode, origin: { readonly x: number; readonly y: number }): Rect {
  const size = CARD_SIZES[node.kind];
  return nodeRect(
    { x: node.position.x - origin.x, y: node.position.y - origin.y },
    size.width,
    size.height,
  );
}

function edgePath(
  edge: ProjectGraphEdge,
  source: Rect | undefined,
  target: Rect | undefined,
  curve: { readonly x: number; readonly y: number } | null,
  obstacles: readonly Rect[],
  bridge: BridgeSpec | null,
  origin: Point,
): string {
  // A missing card can only happen for an edge the caps cut; fall back to a straight segment.
  if (source === undefined || target === undefined) {
    const from = source?.center ?? target?.center ?? { x: 0, y: 0 };
    return edgeGeometry({ source: from, target: from }, curve).path;
  }
  if (edge.source === edge.target) return selfLoopGeometry(source, curve).path;
  // The plan was made in absolute flow coordinates; shift it into the padded picture.
  if (bridge !== null) {
    return bridgeGeometry(shiftBridgeSpec(bridge, { x: -origin.x, y: -origin.y })).path;
  }
  return routeEdge(source, target, { obstacles, curve }).path;
}

/**
 * Build the deterministic scene for one visible view + the committed layout. Bridges default
 * to the view-state default (on); pass { bridges: false } to picture the orthogonal lens.
 */
export function buildGraphScene(
  view: ProjectGraphView,
  layout: GraphLayoutFile,
  palette: GraphScenePalette,
  options?: { readonly bridges?: boolean },
): GraphScene {
  const nodes = [...view.nodes].toSorted(byId);
  const selectedNodes = nodes.slice(0, MAX_SCENE_NODES);
  const included = new Set(selectedNodes.map((node) => node.id));
  const edges = view.edges
    .filter((edge) => included.has(edge.source) && included.has(edge.target))
    .toSorted(byId);
  const selectedEdges = edges.slice(0, MAX_SCENE_EDGES);
  const truncated = selectedNodes.length < nodes.length || selectedEdges.length < edges.length;
  if (selectedNodes.length === 0) {
    return { width: 0, height: 0, nodes: [], edges: [], truncated };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of selectedNodes) {
    const size = CARD_SIZES[node.kind];
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }
  // Plan bridges in absolute flow coordinates first: the apexes fly outside the node bounds,
  // and the picture's padding must cover them so the screenshot clips no arc (issue #65).
  const absoluteRects = new Map<string, Rect>();
  for (const node of selectedNodes) {
    const size = CARD_SIZES[node.kind];
    absoluteRects.set(node.id, nodeRect(node.position, size.width, size.height));
  }
  const bridgePlan = planGraphBridges({
    edges: selectedEdges,
    rects: absoluteRects,
    curves: layout.edgeCurves,
    enabled: options?.bridges ?? true,
  });
  let topExtra = 0;
  let bottomExtra = 0;
  for (const spec of bridgePlan.values()) {
    if (spec.side === "above") {
      topExtra = Math.max(topExtra, minY - spec.apex.y + BRIDGE_LABEL_MARGIN);
    } else {
      bottomExtra = Math.max(bottomExtra, spec.apex.y - maxY + BRIDGE_LABEL_MARGIN);
    }
  }
  const origin = { x: minX - SCENE_PADDING, y: minY - SCENE_PADDING - topExtra };
  const rects = new Map<string, Rect>();
  const sceneNodes: GraphSceneNode[] = selectedNodes.map((node) => {
    const rect = rectFor(node, origin);
    rects.set(node.id, rect);
    return {
      id: node.id,
      kind: node.kind,
      label: node.label,
      rect: {
        x: rect.center.x - rect.width / 2,
        y: rect.center.y - rect.height / 2,
        width: rect.width,
        height: rect.height,
      },
    };
  });
  const obstacles = [...rects.values()];
  const sceneEdges: GraphSceneEdge[] = selectedEdges.map((edge) => {
    const style = edgeStyleOf(edge, palette);
    const bridge = bridgePlan.get(edge.id) ?? null;
    return {
      id: edge.id,
      path: edgePath(
        edge,
        rects.get(edge.source),
        rects.get(edge.target),
        layout.edgeCurves[edge.id] ?? null,
        obstacles,
        bridge,
        origin,
      ),
      stroke: style.stroke,
      dashed: style.dashed,
      ...(bridge === null
        ? {}
        : {
            bridge: {
              apex: { x: bridge.apex.x - origin.x, y: bridge.apex.y - origin.y },
              label: bridgeApexLabel(edge),
            },
          }),
    };
  });
  return {
    width: Math.ceil(maxX - minX + SCENE_PADDING * 2),
    height: Math.ceil(maxY - minY + SCENE_PADDING * 2 + topExtra + bottomExtra),
    nodes: sceneNodes,
    edges: sceneEdges,
    truncated,
  };
}
