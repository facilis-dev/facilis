// The standalone picture of the visible project graph that graph_screenshot renders (D-171).
//
// Pure: the visible view model plus the committed layout go in, a deterministic scene comes out
// (card rects with labels, edge paths, canvas size). React Flow measures cards in the DOM; an
// off-DOM tool cannot, so the sizes here are the card classes' fixed width plus the deterministic
// heights the edge geometry already falls back to. The browser-only raster module paints the
// scene; keeping geometry out of it is what makes this testable in Node.

import type { GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import {
  EDGE_ENDPOINT_GAP,
  edgeGeometry,
  floatingAnchors,
  nodeRect,
  selfLoopGeometry,
  type Rect,
} from "./graph-edge-geometry";
import type { GraphLayoutFile } from "./graph-layout-file";
import type { ProjectGraphEdge, ProjectGraphNode, ProjectGraphView } from "./graph-types";

/**
 * Card classes (w-56/w-60/w-64 = 224/240/256 px) plus the height each kind's content settles at
 * in the panel; the workflow card is wider than the edge fallback because its class says so.
 */
const CARD_SIZES: Readonly<
  Record<GraphNodeKind, { readonly width: number; readonly height: number }>
> = {
  page: { width: 224, height: 44 },
  route: { width: 256, height: 60 },
  table: { width: 240, height: 80 },
  view: { width: 240, height: 80 },
  workflow: { width: 256, height: 64 },
};

/** Blank space around the drawing (self-loops bulge ~62 px out of a card). */
const SCENE_PADDING = 72;

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
): string {
  // A missing card can only happen for an edge the caps cut; fall back to a straight segment.
  if (source === undefined || target === undefined) {
    const from = source?.center ?? target?.center ?? { x: 0, y: 0 };
    return edgeGeometry({ source: from, target: from }, curve).path;
  }
  if (edge.source === edge.target) return selfLoopGeometry(source, curve).path;
  return edgeGeometry(floatingAnchors(source, target, EDGE_ENDPOINT_GAP), curve).path;
}

/** Build the deterministic scene for one visible view + the committed layout. */
export function buildGraphScene(
  view: ProjectGraphView,
  layout: GraphLayoutFile,
  palette: GraphScenePalette,
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
  const origin = { x: minX - SCENE_PADDING, y: minY - SCENE_PADDING };
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
  const sceneEdges: GraphSceneEdge[] = selectedEdges.map((edge) => {
    const style = edgeStyleOf(edge, palette);
    return {
      id: edge.id,
      path: edgePath(
        edge,
        rects.get(edge.source),
        rects.get(edge.target),
        layout.edgeCurves[edge.id] ?? null,
      ),
      stroke: style.stroke,
      dashed: style.dashed,
    };
  });
  return {
    width: Math.ceil(maxX - minX + SCENE_PADDING * 2),
    height: Math.ceil(maxY - minY + SCENE_PADDING * 2),
    nodes: sceneNodes,
    edges: sceneEdges,
    truncated,
  };
}
