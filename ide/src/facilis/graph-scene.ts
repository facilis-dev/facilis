// The standalone picture of the visible project graph that graph_screenshot renders (D-171).
//
// Pure: the visible view model plus the committed layout go in, a deterministic scene comes out
// (card rects with labels, edge paths, canvas size). React Flow measures cards in the DOM; an
// off-DOM tool cannot, so the sizes here are the card classes' fixed width plus the deterministic
// heights the edge geometry already falls back to. The browser-only raster module paints the
// scene; keeping geometry out of it is what makes this testable in Node.

import type { GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { edgeGeometry, nodeRect, selfLoopGeometry, type Rect } from "./graph-edge-geometry";
import { routeEdge } from "./graph-edge-routing";
import { GRAPH_CARD_SIZES } from "./graph-layout-engine";
import type { GraphLayoutFile, GraphPosition } from "./graph-layout-file";
import type { ProjectGraphEdge, ProjectGraphView } from "./graph-types";

/** The engine's card sizes are the scene's sizes: one source of truth keeps the two in sync. */
const CARD_SIZES = GRAPH_CARD_SIZES;

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
  /** "cluster" is a collapsed super-node (issue #62); the rest are the analysis cards. */
  readonly kind: GraphNodeKind | "cluster";
  readonly label: string;
  readonly rect: GraphSceneRect;
}

/** An expanded cluster frame (issue #62): an outline the cards sit inside, never an obstacle. */
export interface GraphSceneFrame {
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
  readonly frames: readonly GraphSceneFrame[];
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

function edgePath(
  edge: ProjectGraphEdge,
  source: Rect | undefined,
  target: Rect | undefined,
  curve: { readonly x: number; readonly y: number } | null,
  obstacles: readonly Rect[],
): string {
  // A missing card can only happen for an edge the caps cut; fall back to a straight segment.
  if (source === undefined || target === undefined) {
    const from = source?.center ?? target?.center ?? { x: 0, y: 0 };
    return edgeGeometry({ source: from, target: from }, curve).path;
  }
  if (edge.source === edge.target) return selfLoopGeometry(source, curve).path;
  return routeEdge(source, target, { obstacles, curve }).path;
}

/** Build the deterministic scene for one visible view + the committed layout. */
export function buildGraphScene(
  view: ProjectGraphView,
  layout: GraphLayoutFile,
  palette: GraphScenePalette,
): GraphScene {
  // Collapsed super-nodes are cards in the picture (their id anchors the boundary edges);
  // expanded frames are outlines around the cards, never obstacles (issue #62).
  const superNodes = view.clusters
    .filter((cluster) => cluster.collapsed)
    .map((cluster) => ({
      id: cluster.id,
      kind: "cluster" as const,
      label: cluster.label,
      position: cluster.position,
      size: cluster.size,
    }));
  const frames = view.clusters.filter((cluster) => !cluster.collapsed);
  const cards = [
    ...view.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      position: node.position,
      size: CARD_SIZES[node.kind],
    })),
    ...superNodes,
  ].toSorted(byId);
  const selectedNodes = cards.slice(0, MAX_SCENE_NODES);
  const included = new Set(selectedNodes.map((node) => node.id));
  const edges = view.edges
    .filter((edge) => included.has(edge.source) && included.has(edge.target))
    .toSorted(byId);
  const selectedEdges = edges.slice(0, MAX_SCENE_EDGES);
  const truncated = selectedNodes.length < cards.length || selectedEdges.length < edges.length;
  if (selectedNodes.length === 0 && frames.length === 0) {
    return { width: 0, height: 0, nodes: [], frames: [], edges: [], truncated };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const boxes = [
    ...selectedNodes,
    ...frames.map((frame) => ({ position: frame.position, size: frame.size })),
  ];
  for (const box of boxes) {
    minX = Math.min(minX, box.position.x);
    minY = Math.min(minY, box.position.y);
    maxX = Math.max(maxX, box.position.x + box.size.width);
    maxY = Math.max(maxY, box.position.y + box.size.height);
  }
  const origin = { x: minX - SCENE_PADDING, y: minY - SCENE_PADDING };
  const toSceneRect = (position: GraphPosition, size: { width: number; height: number }) => ({
    x: position.x - origin.x,
    y: position.y - origin.y,
    width: size.width,
    height: size.height,
  });
  const rects = new Map<string, Rect>();
  const sceneNodes: GraphSceneNode[] = selectedNodes.map((node) => {
    const rect = nodeRect({ x: node.position.x - origin.x, y: node.position.y - origin.y }, node.size.width, node.size.height);
    rects.set(node.id, rect);
    return { id: node.id, kind: node.kind, label: node.label, rect: toSceneRect(node.position, node.size) };
  });
  const sceneFrames: GraphSceneFrame[] = frames.map((frame) => ({
    label: frame.label,
    rect: toSceneRect(frame.position, frame.size),
  }));
  const obstacles = [...rects.values()];
  const sceneEdges: GraphSceneEdge[] = selectedEdges.map((edge) => {
    const style = edgeStyleOf(edge, palette);
    return {
      id: edge.id,
      path: edgePath(
        edge,
        rects.get(edge.source),
        rects.get(edge.target),
        layout.edgeCurves[edge.id] ?? null,
        obstacles,
      ),
      stroke: style.stroke,
      dashed: style.dashed,
    };
  });
  return {
    width: Math.ceil(maxX - minX + SCENE_PADDING * 2),
    height: Math.ceil(maxY - minY + SCENE_PADDING * 2),
    nodes: sceneNodes,
    frames: sceneFrames,
    edges: sceneEdges,
    truncated,
  };
}
