// Canvas2D draw primitives for the map-and-lens surface (D-211, issue #184), ported from the
// validated preview: world-space drawing, viewport culling, no per-node DOM. Colours come from
// palette.ts (semantic role tokens, D-043/D-044), so a theme flip repaints the canvas.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "../graph-types.ts";
import type { SurfaceCamera } from "./camera.ts";
import type { SurfacePort } from "./detail.ts";
import type { SurfaceRect } from "./layout.ts";
import type { SurfacePalette } from "./palette.ts";

export const SURFACE_FONT = "12px system-ui, sans-serif";
export const SURFACE_FONT_BOLD = "600 13px system-ui, sans-serif";
export const FONT_TITLE = "600 18px system-ui, sans-serif";
export const FONT_STATS = "13px system-ui, sans-serif";
const FONT_HEADER = "600 12px system-ui, sans-serif";

/** Edge kinds drawn dashed, mirroring project-graph-edges.ts (same role tokens). */
const DASHED_EDGE_KINDS: ReadonlySet<GraphEdgeKind> = new Set([
  "relation",
  "route-view",
  "view-base",
]);

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 0 && ctx.measureText(cut + "…").width > maxWidth) cut = cut.slice(0, -1);
  return cut + "…";
}

export function centerOf(rect: SurfaceRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The world-space rectangle currently on screen; culling compares against it. */
export function visibleWorldRect(
  camera: SurfaceCamera,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: -camera.tx / camera.scale,
    y0: -camera.ty / camera.scale,
    x1: (width - camera.tx) / camera.scale,
    y1: (height - camera.ty) / camera.scale,
  };
}

export function rectVisible(
  rect: SurfaceRect,
  visible: { x0: number; y0: number; x1: number; y1: number },
  pad = 80,
): boolean {
  return (
    rect.x + rect.w > visible.x0 - pad &&
    rect.x < visible.x1 + pad &&
    rect.y + rect.h > visible.y0 - pad &&
    rect.y < visible.y1 + pad
  );
}

export interface EdgeDrawOptions {
  readonly alpha: number;
  readonly width: number;
  readonly dashed?: boolean;
  readonly arrow?: boolean;
}

export function drawEdge(
  ctx: CanvasRenderingContext2D,
  a: SurfaceRect,
  b: SurfaceRect,
  color: string,
  options: EdgeDrawOptions,
): void {
  const ac = centerOf(a);
  const bc = centerOf(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  ctx.globalAlpha = options.alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = options.width;
  if (options.dashed === true) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  if (Math.abs(dy) > Math.abs(dx)) {
    const sy = a.y + a.h;
    const ty = b.y;
    const d = Math.max(30, Math.abs(ty - sy) * 0.5);
    ctx.moveTo(ac.x, sy);
    ctx.bezierCurveTo(ac.x, sy + d, bc.x, ty - d, bc.x, ty);
  } else {
    const d = Math.max(40, Math.abs(dx) * 0.5);
    ctx.moveTo(ac.x, ac.y);
    ctx.bezierCurveTo(ac.x + d, ac.y, bc.x - d, bc.y, bc.x, bc.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (options.arrow !== false) {
    const angle = Math.atan2(bc.y - ac.y, bc.x - ac.x);
    ctx.save();
    ctx.translate(bc.x, bc.y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-8, -4);
    ctx.lineTo(-8, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export function isDashedEdge(kind: GraphEdgeKind): boolean {
  return DASHED_EDGE_KINDS.has(kind);
}

export interface CardDrawOptions {
  readonly active: boolean;
  readonly alpha: number;
}

function nodeSublabel(node: ProjectGraphNode): string {
  const data = node.data;
  switch (data.kind) {
    case "page":
      return data.pagePath;
    case "route":
      return data.permission.length > 0 ? data.permission.join(", ") : t("projectGraph.public");
    case "table": {
      const parts: string[] = [];
      if (data.framework) parts.push(t("projectGraph.framework"));
      parts.push(data.rlsEnabled ? t("projectGraph.surface.rls") : t("projectGraph.systemOnly"));
      parts.push(t("projectGraph.columns", { count: data.columns.length }));
      return parts.join(" · ");
    }
    case "view":
      return data.access === null
        ? t("projectGraph.unknown")
        : t(("projectGraph.access." + data.access) as MessageKey);
    case "workflow":
      return t("projectGraph.workflow.steps", { count: data.steps.length });
  }
}

export function drawNodeCard(
  ctx: CanvasRenderingContext2D,
  node: ProjectGraphNode,
  rect: SurfaceRect,
  palette: SurfacePalette,
  options: CardDrawOptions & {
    readonly selected: boolean;
    /** The active lens's colour for this node; null when the node is not flagged. */
    readonly lensColor: string | null;
  },
): void {
  const color = palette.kinds[node.kind];
  ctx.globalAlpha = options.alpha;
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 9);
  ctx.fillStyle = palette.card;
  ctx.fill();
  ctx.lineWidth = options.selected ? 2 : 1;
  ctx.strokeStyle = options.selected ? color : options.active ? palette.accent : palette.border;
  ctx.stroke();
  if (options.lensColor !== null) {
    // Ring + dot: the node keeps its position and size, only its ink changes (#189).
    roundRectPath(ctx, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 11);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = options.lensColor;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rect.x + rect.w - 11, rect.y + 11, 5, 0, Math.PI * 2);
    ctx.fillStyle = options.lensColor;
    ctx.fill();
  }
  roundRectPath(ctx, rect.x, rect.y, 5, rect.h, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.font = SURFACE_FONT_BOLD;
  ctx.fillStyle = palette.foreground;
  ctx.fillText(truncateText(ctx, node.label, rect.w - 44), rect.x + 14, rect.y + 22);
  ctx.font = SURFACE_FONT;
  ctx.fillStyle = palette.muted;
  ctx.fillText(truncateText(ctx, nodeSublabel(node), rect.w - 24), rect.x + 14, rect.y + 42);
  if (node.data.kind === "route" && node.data.elevations.length > 0) {
    ctx.fillStyle = palette.elevated;
    const label = t("projectGraph.elevated");
    ctx.fillText(label, rect.x + rect.w - ctx.measureText(label).width - 10, rect.y + 42);
  } else if (node.data.kind !== "page" && node.data.unknown) {
    ctx.fillStyle = palette.muted;
    const label = t("projectGraph.unknown");
    ctx.fillText(label, rect.x + rect.w - ctx.measureText(label).width - 10, rect.y + 22);
  }
  ctx.globalAlpha = 1;
}

export function drawPort(
  ctx: CanvasRenderingContext2D,
  port: SurfacePort,
  palette: SurfacePalette,
  options: CardDrawOptions,
): void {
  const { rect } = port;
  ctx.globalAlpha = options.alpha;
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 8);
  ctx.fillStyle = options.active ? palette.cardActive : palette.card;
  ctx.fill();
  ctx.strokeStyle = options.active ? palette.accent : palette.border;
  ctx.lineWidth = options.active ? 2 : 1;
  ctx.stroke();
  ctx.fillStyle = palette.muted;
  ctx.font = SURFACE_FONT;
  const key =
    port.direction === "out" ? "projectGraph.surface.portOut" : "projectGraph.surface.portIn";
  const label = t(key, { domain: port.domain, count: port.links.length });
  ctx.fillText(truncateText(ctx, label, rect.w - 16), rect.x + 8, rect.y + 21);
  ctx.globalAlpha = 1;
}

export function drawLaneHeader(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lane: string,
  palette: SurfacePalette,
): void {
  ctx.font = FONT_HEADER;
  ctx.fillStyle = palette.muted;
  ctx.fillText(t(("projectGraph.surface.lane." + lane) as MessageKey).toUpperCase(), x, y);
}
