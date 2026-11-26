// Deterministic layouts for the map-and-lens surface (D-219, issue #184), ported from the
// validated static preview. Computed ONCE per dataset/domain and cached by the caller: pan and
// zoom are pure camera transforms and never re-run layout. No screen-size branch exists here,
// so desktop and mobile share the exact same spatial layout (pan instead of reflow).

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types.ts";
import type { GraphDomain } from "./domains.ts";

export interface SurfaceRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const OVERVIEW_CARD_W = 240;
export const OVERVIEW_CARD_H = 150;

const OVERVIEW_GAP_X = 130;
const OVERVIEW_GAP_Y = 96;

export interface DomainOverviewCard {
  readonly name: string;
  readonly rect: SurfaceRect;
  readonly counts: Readonly<Record<GraphNodeKind, number>>;
  readonly total: number;
  /** Edges with at least one endpoint in this domain. */
  readonly links: number;
}

/** An aggregate cross-domain connection; its count drives the drawn thickness. */
export interface DomainLink {
  readonly a: string;
  readonly b: string;
  readonly count: number;
}

export interface OverviewLayout {
  readonly cards: readonly DomainOverviewCard[];
  readonly links: readonly DomainLink[];
  readonly bounds: SurfaceRect;
}

/** A labelled cross-domain port: clicking it navigates to the other domain. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function boundsOf(rects: Iterable<SurfaceRect>): SurfaceRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** One card per domain on a centered grid; aggregate links carry the coupling count. */
export function overviewLayout(
  domains: readonly GraphDomain[],
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
): OverviewLayout {
  const count = domains.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.7)));
  const rows = Math.ceil(count / cols);
  const totalW = cols * OVERVIEW_CARD_W + (cols - 1) * OVERVIEW_GAP_X;
  const totalH = rows * OVERVIEW_CARD_H + (rows - 1) * OVERVIEW_GAP_Y;
  const domainOf = new Map<string, string>();
  for (const domain of domains) {
    for (const id of domain.nodeIds) domainOf.set(id, domain.name);
  }
  const counts = new Map<string, Record<GraphNodeKind, number>>();
  const links = new Map<string, number>();
  for (const domain of domains) {
    counts.set(domain.name, { page: 0, route: 0, table: 0, view: 0, workflow: 0 });
    links.set(domain.name, 0);
  }
  for (const node of nodes) {
    const record = counts.get(domainOf.get(node.id) ?? "");
    if (record !== undefined) record[node.kind] += 1;
  }
  const tally = new Map<string, DomainLink>();
  for (const edge of edges) {
    const a = domainOf.get(edge.source);
    const b = domainOf.get(edge.target);
    if (a !== undefined) links.set(a, (links.get(a) ?? 0) + 1);
    if (b !== undefined && b !== a) links.set(b, (links.get(b) ?? 0) + 1);
    if (a === undefined || b === undefined || a === b) continue;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const key = lo + "\u0000" + hi;
    const existing = tally.get(key);
    if (existing === undefined) tally.set(key, { a: lo, b: hi, count: 1 });
    else tally.set(key, { ...existing, count: existing.count + 1 });
  }
  const cards = domains.map((domain, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const record = counts.get(domain.name) ?? { page: 0, route: 0, table: 0, view: 0, workflow: 0 };
    return {
      name: domain.name,
      rect: {
        x: col * (OVERVIEW_CARD_W + OVERVIEW_GAP_X) - totalW / 2,
        y: row * (OVERVIEW_CARD_H + OVERVIEW_GAP_Y) - totalH / 2,
        w: OVERVIEW_CARD_W,
        h: OVERVIEW_CARD_H,
      },
      counts: record,
      total: domain.nodeIds.length,
      links: links.get(domain.name) ?? 0,
    };
  });
  return {
    cards,
    links: [...tally.values()].toSorted((a, b) => compareText(a.a, b.a) || compareText(a.b, b.b)),
    bounds: boundsOf(cards.map((card) => card.rect)),
  };
}
