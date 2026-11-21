// The minimap's projection math (issue #68). Pure: world bounds → minimap scale/offset, node
// rects, the viewport rectangle from {x,y,zoom} + container size, and pointer deltas → viewport
// pans. The component only maps these onto SVG and pointer events; dragging calls setViewport
// on the React Flow instance, never a layout setter, so node positions are never recomputed
// (epic #56 rule 2, spatial constancy).
//
// React Flow's viewport transform is screen = world * zoom + {x,y}; the visible world region
// is therefore (-x/zoom, -y/zoom) sized container/zoom. Every function here assumes that
// convention, the same one graph-layout-file.ts persists.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { GraphViewport } from "./graph-layout-file";

export interface MinimapSize {
  readonly width: number;
  readonly height: number;
}

export interface MinimapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a minimap rect stands for: a card kind, or a #62 feature-cluster frame. */
export type MinimapKind = GraphNodeKind | "cluster";

/** One drawn card: its real bounds, so a collapsed card reads as the smaller block it actually
 * is. A cluster frame is drawn too (its members may be collapsed into a super-node), as a
 * neutral block behind the cards. */
export interface MinimapNode extends MinimapRect {
  readonly id: string;
  readonly kind: MinimapKind;
}

export interface MinimapProjection {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** The drawn minimap surface, in CSS pixels (the SVG viewBox matches it). */
export const MINIMAP_SIZE: MinimapSize = { width: 160, height: 112 };

/** World-space margin around the node bounds so edge cards never touch the minimap border. */
export const MINIMAP_WORLD_PADDING = 60;

/**
 * One card's minimap rect: the view position plus React Flow's measured size when present,
 * the kind fallback otherwise. Shared by the minimap list and the zoom-to-node target so both
 * agree on a card's bounds; a collapsed card's smaller measurement reads as a smaller block.
 */
export function minimapNodeRect(
  node: {
    readonly id: string;
    readonly kind: GraphNodeKind;
    readonly position: { x: number; y: number };
  },
  measured: { readonly width?: number; readonly height?: number } | undefined,
  fallback: { readonly width: number; readonly height: number },
): MinimapNode {
  return {
    id: node.id,
    kind: node.kind,
    x: node.position.x,
    y: node.position.y,
    width: measured?.width ?? fallback.width,
    height: measured?.height ?? fallback.height,
  };
}

/** One cluster frame's minimap rect (#62): the frame's absolute box, behind its cards. */
export function minimapFrameRect(cluster: {
  readonly id: string;
  readonly position: { x: number; y: number };
  readonly size: { readonly width: number; readonly height: number };
}): MinimapNode {
  return {
    id: cluster.id,
    kind: "cluster",
    x: cluster.position.x,
    y: cluster.position.y,
    width: cluster.size.width,
    height: cluster.size.height,
  };
}

/** Union of the node rects plus a margin; null when nothing is drawn. */
export function minimapBounds(nodes: readonly MinimapNode[]): MinimapRect | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return {
    x: minX - MINIMAP_WORLD_PADDING,
    y: minY - MINIMAP_WORLD_PADDING,
    width: maxX - minX + MINIMAP_WORLD_PADDING * 2,
    height: maxY - minY + MINIMAP_WORLD_PADDING * 2,
  };
}

/** Fit the world bounds into the minimap, preserving aspect ratio and centring the content. */
export function minimapProjection(
  bounds: MinimapRect,
  size: MinimapSize = MINIMAP_SIZE,
): MinimapProjection {
  const scale = Math.min(size.width / bounds.width, size.height / bounds.height);
  return {
    scale,
    offsetX: (size.width - bounds.width * scale) / 2 - bounds.x * scale,
    offsetY: (size.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

export function projectMinimapRect(rect: MinimapRect, projection: MinimapProjection): MinimapRect {
  return {
    x: rect.x * projection.scale + projection.offsetX,
    y: rect.y * projection.scale + projection.offsetY,
    width: rect.width * projection.scale,
    height: rect.height * projection.scale,
  };
}

/** The visible world region as a minimap rect; it may overflow the surface (SVG clips it). */
export function minimapViewportRect(
  viewport: GraphViewport,
  container: MinimapSize,
  projection: MinimapProjection,
): MinimapRect {
  return projectMinimapRect(
    {
      x: -viewport.x / viewport.zoom,
      y: -viewport.y / viewport.zoom,
      width: container.width / viewport.zoom,
      height: container.height / viewport.zoom,
    },
    projection,
  );
}

/** A minimap point back to world coordinates (the inverse of the projection). */
export function minimapToWorld(
  point: { x: number; y: number },
  projection: MinimapProjection,
): { x: number; y: number } {
  return {
    x: (point.x - projection.offsetX) / projection.scale,
    y: (point.y - projection.offsetY) / projection.scale,
  };
}

/**
 * Pointer drag → viewport pan. Moving the viewport rectangle by d minimap pixels moves the
 * world by d/scale, and the viewport origin moves the OPPOSITE way scaled by zoom:
 * delta = -d/scale*zoom. Zoom is untouched, so no layout or fit is ever recomputed.
 */
export function minimapPanDelta(
  delta: { x: number; y: number },
  projection: MinimapProjection,
  zoom: number,
): { x: number; y: number } {
  return {
    x: (-delta.x / projection.scale) * zoom,
    y: (-delta.y / projection.scale) * zoom,
  };
}

/** Centre the viewport on a world point at the current zoom (minimap click / arrow keys). */
export function centerOnWorldPoint(
  point: { x: number; y: number },
  zoom: number,
  container: MinimapSize,
): GraphViewport {
  return {
    x: container.width / 2 - point.x * zoom,
    y: container.height / 2 - point.y * zoom,
    zoom,
  };
}
