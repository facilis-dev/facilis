// Scene assembly and the single-frame draw for the map-and-lens surface (D-211, issue #184).
// A scene is built once per dataset/domain and cached; drawing reads it plus the camera, so a
// pan/zoom frame never re-runs layout. The caller redraws only when dirty (idle cost is zero).

import type { GraphPosition } from "../graph-layout-file.ts";
import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types.ts";
import type { GraphDomain } from "./domains.ts";
import type { SurfaceCamera } from "./camera.ts";
import { detailLayout, type DetailLayout } from "./detail.ts";
import { buildNeighborIndex } from "./focus.ts";
import { domainFlagCounts, type GraphLensHighlight } from "./lenses.ts";
import { detailWithSavedPositions } from "./positions.ts";
import { overviewLayout, type OverviewLayout } from "./layout.ts";
import type { SurfacePalette } from "./palette.ts";
import { drawDomainCard } from "./render-domain.ts";
import {
  drawEdge,
  drawLaneHeader,
  drawNodeCard,
  drawPort,
  isDashedEdge,
  rectVisible,
  visibleWorldRect,
} from "./render.ts";

export interface SurfaceView {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface SurfaceInteraction {
  readonly hoverId: string | null;
  readonly selectedId: string | null;
  /** The toolbar search, lowercased; empty means no dimming. */
  readonly query: string;
  readonly matched: ReadonlySet<string>;
  /** The selected node's neighbourhood; null means selection does not dim anything. */
  readonly focus: ReadonlySet<string> | null;
  /** The active lens highlight; null means no lens is active (issue #189). */
  readonly lens: GraphLensHighlight | null;
}

export interface OverviewScene {
  readonly mode: "overview";
  readonly layout: OverviewLayout;
  readonly nodes: readonly ProjectGraphNode[];
  readonly domainOf: ReadonlyMap<string, string>;
}

export interface DetailScene {
  readonly mode: "detail";
  readonly domain: string;
  readonly layout: DetailLayout;
  /** Automatic swimlane column x's: the snap targets for a dropped node (issue #185). */
  readonly columns: readonly number[];
  readonly nodeById: ReadonlyMap<string, ProjectGraphNode>;
  /** Undirected adjacency over the full graph: the focus neighbourhood, never a layout input. */
  readonly neighbors: ReadonlyMap<string, readonly string[]>;
}

export type SurfaceScene = OverviewScene | DetailScene;

export function buildOverviewScene(
  domains: readonly GraphDomain[],
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
): OverviewScene {
  const domainOf = new Map<string, string>();
  for (const domain of domains) {
    for (const id of domain.nodeIds) domainOf.set(id, domain.name);
  }
  return { mode: "overview", layout: overviewLayout(domains, nodes, edges), nodes, domainOf };
}

export function buildDetailScene(
  domain: string,
  nodes: readonly ProjectGraphNode[],
  domainOf: ReadonlyMap<string, string>,
  edges: readonly ProjectGraphEdge[],
  saved: Readonly<Record<string, GraphPosition>> = {},
): DetailScene {
  const auto = detailLayout({ domain, nodes, domainOf, edges });
  const { layout, columns } = detailWithSavedPositions(auto, saved);
  const nodeById = new Map<string, ProjectGraphNode>();
  for (const node of nodes) {
    if (domainOf.get(node.id) === domain) nodeById.set(node.id, node);
  }
  return {
    mode: "detail",
    domain,
    layout,
    columns,
    nodeById,
    neighbors: buildNeighborIndex(edges),
  };
}

export type SurfaceHit =
  | { readonly kind: "domain"; readonly name: string }
  | { readonly kind: "port"; readonly domain: string; readonly id: string }
  | { readonly kind: "node"; readonly id: string };

function inside(
  rect: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** Topmost hit at a world point: ports before cards, cards before empty space. */
export function hitTestSurface(scene: SurfaceScene, x: number, y: number): SurfaceHit | null {
  if (scene.mode === "overview") {
    for (const card of scene.layout.cards) {
      if (inside(card.rect, x, y)) return { kind: "domain", name: card.name };
    }
    return null;
  }
  for (const port of scene.layout.ports) {
    if (inside(port.rect, x, y)) return { kind: "port", domain: port.domain, id: port.id };
  }
  for (const [id, rect] of scene.layout.positions) {
    if (inside(rect, x, y)) return { kind: "node", id };
  }
  return null;
}

function drawOverviewFrame(
  ctx: CanvasRenderingContext2D,
  scene: OverviewScene,
  palette: SurfacePalette,
  ui: SurfaceInteraction,
  visible: { x0: number; y0: number; x1: number; y1: number },
): void {
  for (const link of scene.layout.links) {
    const a = scene.layout.cards.find((card) => card.name === link.a)?.rect;
    const b = scene.layout.cards.find((card) => card.name === link.b)?.rect;
    if (a === undefined || b === undefined) continue;
    drawEdge(ctx, a, b, palette.muted, {
      alpha: 0.35,
      width: Math.min(7, 1 + link.count * 0.7),
      arrow: false,
    });
  }
  const searching = ui.query.length > 0;
  const matchesByDomain = new Map<string, number>();
  if (searching) {
    for (const node of scene.nodes) {
      if (!ui.matched.has(node.id)) continue;
      const domain = scene.domainOf.get(node.id);
      if (domain !== undefined) matchesByDomain.set(domain, (matchesByDomain.get(domain) ?? 0) + 1);
    }
  }
  // Lens badges are per-domain flag counts; the rest of the grid dims but never moves.
  const lens = ui.lens;
  const flagsByDomain = lens === null ? null : domainFlagCounts(scene.domainOf, lens.flagged);
  const flagColors = new Map<string, string>();
  if (lens !== null) {
    for (const id of lens.flagged) {
      const domain = scene.domainOf.get(id);
      if (domain === undefined || flagColors.has(domain)) continue;
      const code = lens.codeOf.get(id);
      if (code !== undefined) flagColors.set(domain, palette.diagnostics[code]);
    }
  }
  for (const card of scene.layout.cards) {
    if (!rectVisible(card.rect, visible)) continue;
    const matches = searching ? (matchesByDomain.get(card.name) ?? 0) : null;
    const flags = flagsByDomain?.get(card.name) ?? null;
    let alpha = searching && matches === 0 ? 0.45 : 1;
    if (flagsByDomain !== null && (flags ?? 0) === 0) alpha = Math.min(alpha, 0.35);
    drawDomainCard(ctx, card, palette, {
      active: ui.hoverId === card.name,
      alpha,
      matches,
      flags,
      flagColor: flagColors.get(card.name) ?? palette.accent,
    });
  }
}

/** A lens keeps the flagged nodes fully inked and dims the rest without moving anything. */
function lensAlpha(flagged: boolean): number {
  return flagged ? 1 : 0.12;
}

function drawDetailFrame(
  ctx: CanvasRenderingContext2D,
  scene: DetailScene,
  palette: SurfacePalette,
  ui: SurfaceInteraction,
  visible: { x0: number; y0: number; x1: number; y1: number },
): void {
  const { layout } = scene;
  for (const header of layout.headers) {
    drawLaneHeader(ctx, header.x, header.y, header.lane, palette);
  }
  const searching = ui.query.length > 0;
  const focus = ui.focus;
  const lens = ui.lens;
  const outsideFocus = (id: string): boolean => focus !== null && !focus.has(id);
  const nodeAlpha = (id: string): number => {
    if (lens !== null) return lensAlpha(lens.flagged.has(id));
    let alpha = outsideFocus(id) ? 0.12 : 1;
    if (searching && !ui.matched.has(id)) alpha = Math.min(alpha, 0.2);
    return alpha;
  };
  for (const edge of layout.edges) {
    const a = layout.positions.get(edge.source);
    const b = layout.positions.get(edge.target);
    if (a === undefined || b === undefined) continue;
    const elevated = edge.access === "elevated";
    const dim =
      lens !== null
        ? !lens.flagged.has(edge.source) && !lens.flagged.has(edge.target)
        : (outsideFocus(edge.source) && outsideFocus(edge.target)) ||
          (searching && !ui.matched.has(edge.source) && !ui.matched.has(edge.target));
    drawEdge(ctx, a, b, elevated ? palette.elevated : palette.edges[edge.kind], {
      alpha: dim ? 0.06 : 0.35,
      width: 1.3,
      dashed: !elevated && isDashedEdge(edge.kind),
    });
  }
  for (const port of layout.ports) {
    for (const localId of port.links) {
      const rect = layout.positions.get(localId);
      if (rect === undefined) continue;
      drawEdge(ctx, rect, port.rect, palette.muted, {
        alpha:
          lens !== null
            ? lens.flagged.has(localId)
              ? 0.25
              : 0.05
            : outsideFocus(localId)
              ? 0.05
              : 0.25,
        width: 1.1,
        dashed: true,
        arrow: false,
      });
    }
    if (!rectVisible(port.rect, visible)) continue;
    const portFocused =
      lens !== null
        ? port.links.some((id) => lens.flagged.has(id))
        : focus === null || port.links.some((id) => focus.has(id));
    drawPort(ctx, port, palette, {
      active: ui.hoverId === port.id,
      alpha: portFocused ? 1 : 0.15,
    });
  }
  for (const [id, rect] of layout.positions) {
    if (!rectVisible(rect, visible)) continue;
    const node = scene.nodeById.get(id);
    if (node === undefined) continue;
    const code = lens?.codeOf.get(id);
    drawNodeCard(ctx, node, rect, palette, {
      active: ui.hoverId === id,
      selected: ui.selectedId === id,
      alpha: nodeAlpha(id),
      lensColor: code === undefined ? null : palette.diagnostics[code],
    });
  }
}

/** Draw exactly one frame; the caller decides when (dirty-only loop). */
export function drawSurface(
  ctx: CanvasRenderingContext2D,
  scene: SurfaceScene,
  camera: SurfaceCamera,
  view: SurfaceView,
  palette: SurfacePalette,
  ui: SurfaceInteraction,
): void {
  const { dpr } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.width * dpr, view.height * dpr);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, view.width * dpr, view.height * dpr);
  ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.tx, dpr * camera.ty);
  const visible = visibleWorldRect(camera, view.width, view.height);
  if (scene.mode === "overview") drawOverviewFrame(ctx, scene, palette, ui, visible);
  else drawDetailFrame(ctx, scene, palette, ui, visible);
}
