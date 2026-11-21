// Keyboard navigation math for the project graph (issue #68, epic #56 rule 6): zoom presets,
// the zoom-to-node target viewport, the reduced-motion duration choice and the breadcrumb
// trail data. Pure so every target is unit-testable; the navigation hook maps them onto the
// React Flow instance (setViewport/zoomTo accept {duration}).

import type { GraphViewport } from "./graph-layout-file";
import type { MinimapRect, MinimapSize } from "./graph-minimap";

/** The canvas's zoom clamp (ProjectGraphCanvas's minZoom/maxZoom); targets must respect it. */
export const GRAPH_MIN_ZOOM = 0.05;
export const GRAPH_MAX_ZOOM = 2;

/**
 * Viewport zoom presets for the 1/2 keys. They are plain zoom changes today; the semantic LOD
 * of sibling issue #60 (PR #120, not in this base) bands on exactly these thresholds —
 * chip < 0.45 <= compact <= 0.9 < full — so preset 1 lands in the compact band and preset 2 in
 * the full band, and the LOD will react to them once it merges. Do not move them out of band.
 */
export const GRAPH_ZOOM_PRESET_COMPACT = 0.6;
export const GRAPH_ZOOM_PRESET_FULL = 1.2;

/** Zoom-to-node centres the card at full-band detail (the LOD's detail band once #60 lands). */
export const GRAPH_NODE_FOCUS_ZOOM = GRAPH_ZOOM_PRESET_FULL;

/** The animated viewport duration; prefers-reduced-motion collapses it to 0 (instant). */
export const GRAPH_ZOOM_ANIMATION_MS = 250;

export function clampGraphZoom(zoom: number): number {
  return Math.min(GRAPH_MAX_ZOOM, Math.max(GRAPH_MIN_ZOOM, zoom));
}

export function zoomAnimationDuration(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : GRAPH_ZOOM_ANIMATION_MS;
}

/** Centre the node's bounds in the container at the detail zoom, clamped to the canvas band. */
export function zoomToNodeViewport(
  bounds: MinimapRect,
  container: MinimapSize,
  zoom: number = GRAPH_NODE_FOCUS_ZOOM,
): GraphViewport {
  const clamped = clampGraphZoom(zoom);
  return {
    x: container.width / 2 - (bounds.x + bounds.width / 2) * clamped,
    y: container.height / 2 - (bounds.y + bounds.height / 2) * clamped,
    zoom: clamped,
  };
}

/** The world point currently at the container centre under this viewport. */
export function viewportWorldCenter(
  viewport: GraphViewport,
  container: MinimapSize,
): { x: number; y: number } {
  return {
    x: (container.width / 2 - viewport.x) / viewport.zoom,
    y: (container.height / 2 - viewport.y) / viewport.zoom,
  };
}

/** A preset zoom (or the 0 key's 100% reset) keeps the world centre: only the zoom changes. */
export function presetZoomViewport(
  viewport: GraphViewport,
  container: MinimapSize,
  zoom: number,
): GraphViewport {
  const clamped = clampGraphZoom(zoom);
  const center = viewportWorldCenter(viewport, container);
  return {
    x: container.width / 2 - center.x * clamped,
    y: container.height / 2 - center.y * clamped,
    zoom: clamped,
  };
}

/** Pan by a screen-pixel delta (minimap arrow keys); zoom is untouched. */
export function panViewport(
  viewport: GraphViewport,
  delta: { x: number; y: number },
): GraphViewport {
  return { x: viewport.x + delta.x, y: viewport.y + delta.y, zoom: viewport.zoom };
}

export type GraphBreadcrumbKind = "project" | "cluster" | "node";

export interface GraphBreadcrumbItem {
  readonly kind: GraphBreadcrumbKind;
  /** Null for the project root; the node id otherwise (a cluster id once #62 lands). */
  readonly id: string | null;
  /** The node/cluster label; the project root resolves its own title through t(). */
  readonly label: string | null;
}

/**
 * The trail is project → cluster → node: the cluster level is the #62 drill-down (the capstone
 * fills the cluster-breadcrumb slot it left), the node level the shared selection. Either
 * level may be absent, and both are plain data — the navigation hook dispatches the same item
 * the component renders, so the keyboard (Enter on a focused crumb) and the pointer reach the
 * exact same navigation (rule 6).
 */
export function buildGraphBreadcrumbs(
  selected: { readonly id: string; readonly label: string } | null,
  cluster: { readonly id: string; readonly label: string } | null = null,
): GraphBreadcrumbItem[] {
  const trail: GraphBreadcrumbItem[] = [{ kind: "project", id: null, label: null }];
  if (cluster !== null) trail.push({ kind: "cluster", id: cluster.id, label: cluster.label });
  if (selected !== null) trail.push({ kind: "node", id: selected.id, label: selected.label });
  return trail;
}

export interface GraphShortcut {
  readonly id: string;
  /** The key glyph shown in the sheet; a literal, not translatable prose. */
  readonly keys: string;
  /** The action's accessible name key (D-043); every command appears in the sheet. */
  readonly labelKey: string;
}

/** Every plain-key shortcut plus the palette combo, in sheet order (issue #68 criterion 6). */
export const GRAPH_SHORTCUTS: readonly GraphShortcut[] = [
  { id: "palette", keys: "⌘/Ctrl K", labelKey: "projectGraph.palette.trigger" },
  { id: "fit", keys: "F", labelKey: "projectGraph.fit" },
  { id: "reset-zoom", keys: "0", labelKey: "projectGraph.shortcuts.resetZoom" },
  { id: "preset-compact", keys: "1", labelKey: "projectGraph.shortcuts.presetCompact" },
  { id: "preset-full", keys: "2", labelKey: "projectGraph.shortcuts.presetFull" },
  { id: "toggle-mode", keys: "M", labelKey: "projectGraph.shortcuts.toggleMatrix" },
  { id: "group-by", keys: "G", labelKey: "projectGraph.cluster.toggle" },
  { id: "collapse-cluster", keys: "C", labelKey: "projectGraph.cluster.collapse" },
  { id: "concentration", keys: "E", labelKey: "projectGraph.hud.concentration" },
  { id: "bridges", keys: "B", labelKey: "projectGraph.bridges" },
  { id: "enter", keys: "Enter", labelKey: "projectGraph.shortcuts.enter" },
  { id: "escape", keys: "Esc", labelKey: "projectGraph.shortcuts.escape" },
  { id: "help", keys: "?", labelKey: "projectGraph.shortcuts.help" },
];
