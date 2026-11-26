// Theme-aware palette for the graph surface (D-043/D-044): colours resolve from the IDE's
// semantic role tokens at runtime, so a theme flip repaints the canvas. Edge tokens mirror
// project-graph-edges.ts; system-color fallbacks only cover a document with no theme block.

import type { GraphDiagnosticCode, GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { DIAGNOSTIC_COLOR_TOKENS } from "./lenses.ts";

const EDGE_TOKENS: Record<GraphEdgeKind, string> = {
  fk: "--brand",
  relation: "--info",
  "route-table": "--muted-foreground",
  "page-route": "--success",
  "page-link": "--brand",
  "route-view": "--info",
  "view-base": "--muted-foreground",
};
const KIND_TOKENS: Record<GraphNodeKind, string> = {
  page: "--success",
  route: "--info",
  table: "--warning",
  view: "--brand",
  workflow: "--primary",
};

export interface SurfacePalette {
  readonly background: string;
  readonly card: string;
  readonly cardActive: string;
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly accent: string;
  readonly elevated: string;
  readonly kinds: Readonly<Record<GraphNodeKind, string>>;
  readonly edges: Readonly<Record<GraphEdgeKind, string>>;
  /** Lens highlight colours, keyed by diagnostic code (D-220). */
  readonly diagnostics: Readonly<Record<GraphDiagnosticCode, string>>;
}

/** Read the active theme's role tokens once per frame batch; never hardcode palette colours. */
export function resolveSurfacePalette(element: HTMLElement): SurfacePalette {
  const styles = getComputedStyle(element);
  const read = (token: string, fallback: string): string => {
    const value = styles.getPropertyValue(token).trim();
    return value.length > 0 ? value : fallback;
  };
  const kinds = {} as Record<GraphNodeKind, string>;
  for (const kind of Object.keys(KIND_TOKENS) as GraphNodeKind[]) {
    kinds[kind] = read(KIND_TOKENS[kind], "CanvasText");
  }
  const edges = {} as Record<GraphEdgeKind, string>;
  for (const kind of Object.keys(EDGE_TOKENS) as GraphEdgeKind[]) {
    edges[kind] = read(EDGE_TOKENS[kind], "CanvasText");
  }
  const diagnostics = {} as Record<GraphDiagnosticCode, string>;
  for (const code of Object.keys(DIAGNOSTIC_COLOR_TOKENS) as GraphDiagnosticCode[]) {
    diagnostics[code] = read(DIAGNOSTIC_COLOR_TOKENS[code], "CanvasText");
  }
  return {
    background: read("--editor", "Canvas"),
    card: read("--card", "Canvas"),
    cardActive: read("--accent", "Canvas"),
    foreground: read("--foreground", "CanvasText"),
    muted: read("--muted-foreground", "CanvasText"),
    border: read("--border", "CanvasText"),
    accent: read("--primary", "CanvasText"),
    elevated: read("--warning", "CanvasText"),
    kinds,
    edges,
    diagnostics,
  };
}
