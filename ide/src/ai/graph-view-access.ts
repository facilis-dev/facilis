// The AI-facing facade over the project graph's VISIBLE view (D-171).
//
// D-126 tools read and write the committed state; these three act on what the panel draws: the
// analysis' graph with saved positions, hidden edge kinds, collapsed cards and the system-node
// filters applied. A tool call must name the same ids the canvas renders, so every method loads
// that one view (facilis/graph-view-load.ts) and resolves the ids against it.
//
// highlight/paths open the graph tab and hand the ids to the panel through graph-focus.ts; the
// request is module state because the panel unmounts with its tab. A screenshot is rendered
// off-DOM (graph-scene + graph-raster) and pushed onto the host image channel, which turn.ts
// drains onto the tool-result turn exactly like preview screenshots (D-112).

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { notifyGraphFocus } from "@/facilis/graph-focus";
import { GRAPH_EDGE_KINDS } from "@/facilis/graph-types";
import { findGraphPaths } from "@/facilis/graph-paths";
import { rasterizeGraphScene, type GraphRasterImage } from "@/facilis/graph-raster";
import {
  buildGraphScene,
  type GraphScene,
  type GraphScenePalette,
  type GraphSceneEdgeStyle,
} from "@/facilis/graph-scene";
import { loadGraphView, type GraphViewLoad } from "@/facilis/graph-view-load";
import type { ProjectGraphView } from "@/facilis/graph-types";
import type { IdeController } from "@/vv/controller";
import type { PtcJson } from "./ptc/protocol";

/** At most two graph screenshots travel with one program's result (D-112/D-171). */
const MAX_IMAGES = 2;
/** The model gets a bounded picture; 1536 px keeps the JPEG small and the cards legible. */
const SCREENSHOT_DIMENSION = 1536;
const SCREENSHOT_QUALITY = 0.8;

export interface GraphHighlightRequest {
  /** Visible node ids to focus; an empty set clears the focus. */
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
  /** False keeps the current viewport; true fits the focused ids. */
  readonly zoom: boolean;
}

export interface GraphPathsRequest {
  readonly from: string;
  readonly to?: string;
  readonly maxPaths: number;
  readonly maxHops: number;
  /** False keeps the graph tab closed and the focus untouched. */
  readonly highlight: boolean;
}

export interface GraphCaptureRequest {
  /** Absent/empty renders the whole visible view. */
  readonly nodes?: readonly string[];
  readonly edges?: readonly string[];
}

export interface GraphViewAccess {
  highlight(request: GraphHighlightRequest): Promise<PtcJson>;
  paths(request: GraphPathsRequest): Promise<PtcJson>;
  /** Render the visible view (or an id subset) and queue the image for this program. */
  capture(request: GraphCaptureRequest): Promise<PtcJson>;
  /** Drain the screenshots taken since the last call; the turn loop attaches them. */
  takeImages(): string[];
}

/** Injectable seams: the tests supply a pure view, a stub painter and a focus recorder. */
export interface GraphViewAccessDeps {
  readonly loadView?: (controller: IdeController) => Promise<GraphViewLoad>;
  readonly render?: (scene: GraphScene, palette: GraphScenePalette) => GraphRasterImage | null;
  readonly palette?: () => GraphScenePalette;
  readonly openGraph?: () => void;
}

/**
 * The theme role tokens the canvas uses, mapped to CSS variables for the off-DOM paint. The
 * mapping mirrors components/ide/project-graph-edges.ts: the AI layer must not import a UI
 * module, so the seven entries are restated here with the same role names (D-043/D-044).
 */
const EDGE_TOKENS: Readonly<
  Record<
    GraphEdgeKind,
    { readonly token: string; readonly fallback: string; readonly dashed: boolean }
  >
> = {
  fk: { token: "--brand", fallback: "#2563eb", dashed: false },
  relation: { token: "--info", fallback: "#0284c7", dashed: true },
  "route-table": { token: "--muted-foreground", fallback: "#71717a", dashed: false },
  "page-route": { token: "--success", fallback: "#16a34a", dashed: false },
  "page-link": { token: "--brand", fallback: "#2563eb", dashed: false },
  "route-view": { token: "--info", fallback: "#0284c7", dashed: true },
  "view-base": { token: "--muted-foreground", fallback: "#71717a", dashed: true },
};

const ELEVATED_TOKEN = { token: "--warning", fallback: "#d97706", dashed: false } as const;

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value.length === 0 ? fallback : value;
}

/** Resolve the theme once per capture: the canvas tokens are the panel's, not a fixed palette. */
function themePalette(): GraphScenePalette {
  const style = getComputedStyle(document.documentElement);
  const edges: Record<GraphEdgeKind, GraphSceneEdgeStyle> = {} as Record<
    GraphEdgeKind,
    GraphSceneEdgeStyle
  >;
  for (const kind of GRAPH_EDGE_KINDS) {
    const token = EDGE_TOKENS[kind];
    edges[kind] = { stroke: cssVar(style, token.token, token.fallback), dashed: token.dashed };
  }
  return {
    background: cssVar(style, "--background", "#ffffff"),
    card: cssVar(style, "--card", "#ffffff"),
    border: cssVar(style, "--border", "#e4e4e7"),
    text: cssVar(style, "--foreground", "#18181b"),
    muted: cssVar(style, "--muted-foreground", "#71717a"),
    edges,
    elevated: {
      stroke: cssVar(style, ELEVATED_TOKEN.token, ELEVATED_TOKEN.fallback),
      dashed: ELEVATED_TOKEN.dashed,
    },
  };
}

function unavailable(reason: string): PtcJson {
  return { ok: false, reason };
}

function uniqueSorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].toSorted((left, right) => left.localeCompare(right));
}

/** The requested subset of the visible view; null when an id is not in that view. */
function subsetOf(view: ProjectGraphView, request: GraphCaptureRequest): ProjectGraphView | null {
  const wantedNodes = request.nodes ?? [];
  const wantedEdges = request.edges ?? [];
  if (wantedNodes.length === 0 && wantedEdges.length === 0) return view;
  const edgeById = new Map(view.edges.map((edge) => [edge.id, edge] as const));
  const visibleNodes = new Set(view.nodes.map((node) => node.id));
  if (wantedNodes.some((id) => !visibleNodes.has(id))) return null;
  const selected = new Set(wantedNodes);
  for (const id of wantedEdges) {
    const edge = edgeById.get(id);
    if (edge === undefined) return null;
    selected.add(edge.source);
    selected.add(edge.target);
  }
  const nodes = view.nodes.filter((node) => selected.has(node.id));
  // A connection is only drawn when both cards are in the picture; an explicit edge brings
  // its endpoints along, so a requested edge is always drawn.
  const edges = view.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target));
  return { nodes, edges, stats: view.stats };
}

export function createGraphViewAccess(
  controller: IdeController,
  deps: GraphViewAccessDeps = {},
): GraphViewAccess {
  const loadView = deps.loadView ?? loadGraphView;
  const palette = deps.palette ?? themePalette;
  const openGraph = deps.openGraph ?? ((): void => controller.openProjectGraph());
  const render =
    deps.render ??
    ((scene: GraphScene, colors: GraphScenePalette): GraphRasterImage | null =>
      rasterizeGraphScene(scene, colors, {
        maxDimension: SCREENSHOT_DIMENSION,
        quality: SCREENSHOT_QUALITY,
      }));
  const images: string[] = [];

  const focus = (nodes: readonly string[], edges: readonly string[], zoom: boolean): void => {
    openGraph();
    notifyGraphFocus({ nodes: [...nodes], edges: [...edges], zoom });
  };

  const highlight = async (request: GraphHighlightRequest): Promise<PtcJson> => {
    const load = await loadView(controller);
    if (!load.ok) return unavailable(load.reason);
    const nodeIds = new Set(load.view.nodes.map((node) => node.id));
    const edgeIds = new Set(load.view.edges.map((edge) => edge.id));
    const nodes = uniqueSorted(request.nodes.filter((id) => nodeIds.has(id)));
    const edges = uniqueSorted(request.edges.filter((id) => edgeIds.has(id)));
    const unknown = uniqueSorted([
      ...request.nodes.filter((id) => !nodeIds.has(id)),
      ...request.edges.filter((id) => !edgeIds.has(id)),
    ]);
    focus(nodes, edges, request.zoom);
    return { ok: true, nodes, edges, unknown };
  };

  const paths = async (request: GraphPathsRequest): Promise<PtcJson> => {
    const load = await loadView(controller);
    if (!load.ok) return unavailable(load.reason);
    const result = findGraphPaths(
      {
        nodeIds: load.view.nodes.map((node) => node.id),
        edges: load.view.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
      },
      {
        from: request.from,
        ...(request.to === undefined ? {} : { to: request.to }),
        maxPaths: request.maxPaths,
        maxHops: request.maxHops,
      },
    );
    if (request.highlight) {
      focus(
        uniqueSorted(result.paths.flatMap((path) => path.nodes)),
        uniqueSorted(result.paths.flatMap((path) => path.edges)),
        true,
      );
    }
    return {
      ok: true,
      paths: result.paths.map((path) => ({ nodes: [...path.nodes], edges: [...path.edges] })),
      unknown: [...result.unknown],
    };
  };

  const capture = async (request: GraphCaptureRequest): Promise<PtcJson> => {
    if (images.length >= MAX_IMAGES) return { captured: false, reason: "image_limit" };
    const load = await loadView(controller);
    if (!load.ok) return { captured: false, reason: load.reason };
    const subset = subsetOf(load.view, request);
    if (subset === null) return { captured: false, reason: "unknown_ids" };
    if (subset.nodes.length === 0) return { captured: false, reason: "empty_graph" };
    try {
      const colors = palette();
      const image = render(buildGraphScene(subset, load.layout, colors), colors);
      if (image === null) return { captured: false, reason: "render_failed" };
      images.push(image.dataUrl);
      return {
        captured: true,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
      };
    } catch {
      // A missing canvas is a state, not a crash: the model can still inspect the view as JSON.
      return { captured: false, reason: "render_failed" };
    }
  };

  return {
    highlight,
    paths,
    capture,
    takeImages(): string[] {
      return images.splice(0, images.length);
    },
  };
}
