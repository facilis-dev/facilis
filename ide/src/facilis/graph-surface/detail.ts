// Swimlane detail layout for the map-and-lens surface (D-211, issue #184): pages | routes |
// data side by side, workflows below, cross-domain ports at the sides. Split from layout.ts so
// both stay under the 300-line source limit. Deterministic and screen-size independent.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types.ts";
import { boundsOf, compareText, type SurfaceRect } from "./layout.ts";

export const DETAIL_CARD_W = 216;
export const DETAIL_CARD_H = 56;
export const PORT_W = 130;
export const PORT_H = 34;

const DETAIL_COL_GAP = 150;
const DETAIL_ROW_GAP = 18;
const WORKFLOW_GAP = 64;
const WORKFLOW_COL_GAP = 40;
const PORT_PITCH = 46;
const PORT_OUT_OFFSET = 90;
const PORT_IN_OFFSET = 220;

export type SurfaceLane = "page" | "route" | "data" | "workflow";

export interface LaneHeader {
  readonly x: number;
  readonly y: number;
  readonly lane: SurfaceLane;
}

export interface SurfacePort {
  readonly id: string;
  readonly domain: string;
  readonly direction: "out" | "in";
  readonly rect: SurfaceRect;
  /** The local nodes this port stands for (one stub edge each). */
  readonly links: readonly string[];
}

export interface DetailLayout {
  /** The working rects: a live drag mutates this map in place (edges follow), never re-layout. */
  readonly positions: Map<string, SurfaceRect>;
  readonly headers: readonly LaneHeader[];
  readonly ports: readonly SurfacePort[];
  /** Internal edges, one distinct edge per ordered connection. */
  readonly edges: readonly ProjectGraphEdge[];
  readonly bounds: SurfaceRect;
}

export interface DetailInput {
  readonly domain: string;
  readonly nodes: readonly ProjectGraphNode[];
  readonly domainOf: ReadonlyMap<string, string>;
  readonly edges: readonly ProjectGraphEdge[];
}

/** Keep one edge per ordered pair: an elevated variant wins, else the first kind/id in order. */
function dedupeEdges(edges: readonly ProjectGraphEdge[]): readonly ProjectGraphEdge[] {
  const byPair = new Map<string, ProjectGraphEdge>();
  for (const edge of edges) {
    const key = edge.source + "\u0000" + edge.target;
    const kept = byPair.get(key);
    if (kept === undefined) {
      byPair.set(key, edge);
      continue;
    }
    const keptElevated = kept.access === "elevated";
    const edgeElevated = edge.access === "elevated";
    if (keptElevated !== edgeElevated) {
      if (edgeElevated) byPair.set(key, edge);
      continue;
    }
    if (
      compareText(edge.kind, kept.kind) < 0 ||
      (edge.kind === kept.kind && compareText(edge.id, kept.id) < 0)
    ) {
      byPair.set(key, edge);
    }
  }
  return [...byPair.values()].toSorted(
    (a, b) =>
      compareText(a.source, b.source) ||
      compareText(a.target, b.target) ||
      compareText(a.kind, b.kind) ||
      compareText(a.id, b.id),
  );
}

export interface DetailInput {
  readonly domain: string;
  readonly nodes: readonly ProjectGraphNode[];
  readonly domainOf: ReadonlyMap<string, string>;
  readonly edges: readonly ProjectGraphEdge[];
}

/**
 * Swimlane detail: pages | routes | data (tables + views) side by side, workflows in a row
 * below; cross-domain connections become labelled ports (out right, in left). Identical on
 * every screen size — the camera, not the layout, adapts.
 */
export function detailLayout(input: DetailInput): DetailLayout {
  const { domain, nodes, domainOf, edges } = input;
  const members = nodes
    .filter((node) => domainOf.get(node.id) === domain)
    .toSorted((a, b) => compareText(a.label, b.label) || compareText(a.id, b.id));
  const byKind = (kind: GraphNodeKind) => members.filter((node) => node.kind === kind);
  const dataItems = [...byKind("table"), ...byKind("view")].toSorted(
    (a, b) => compareText(a.label, b.label) || compareText(a.id, b.id),
  );
  const lanes: { lane: SurfaceLane; items: readonly ProjectGraphNode[] }[] = [];
  const pages = byKind("page");
  const routes = byKind("route");
  const workflows = byKind("workflow");
  if (pages.length > 0) lanes.push({ lane: "page", items: pages });
  if (routes.length > 0) lanes.push({ lane: "route", items: routes });
  if (dataItems.length > 0) lanes.push({ lane: "data", items: dataItems });

  const positions = new Map<string, SurfaceRect>();
  const headers: LaneHeader[] = [];
  const maxRows = Math.max(1, ...lanes.map((entry) => entry.items.length));
  const colHeight =
    lanes.length > 0 ? maxRows * (DETAIL_CARD_H + DETAIL_ROW_GAP) - DETAIL_ROW_GAP : 0;
  lanes.forEach((entry, laneIndex) => {
    const x = laneIndex * (DETAIL_CARD_W + DETAIL_COL_GAP);
    const laneHeight = entry.items.length * (DETAIL_CARD_H + DETAIL_ROW_GAP) - DETAIL_ROW_GAP;
    const startY = -colHeight / 2 + (colHeight - laneHeight) / 2;
    entry.items.forEach((node, rowIndex) => {
      positions.set(node.id, {
        x,
        y: startY + rowIndex * (DETAIL_CARD_H + DETAIL_ROW_GAP),
        w: DETAIL_CARD_W,
        h: DETAIL_CARD_H,
      });
    });
    headers.push({ x, y: -colHeight / 2 - 26, lane: entry.lane });
  });

  const blockW =
    lanes.length > 0
      ? lanes.length * DETAIL_CARD_W + (lanes.length - 1) * DETAIL_COL_GAP
      : DETAIL_CARD_W;
  if (workflows.length > 0) {
    const rowW = workflows.length * DETAIL_CARD_W + (workflows.length - 1) * WORKFLOW_COL_GAP;
    const startX = blockW / 2 - rowW / 2;
    const y = colHeight / 2 + WORKFLOW_GAP;
    headers.push({ x: startX, y: y - 22, lane: "workflow" });
    workflows.forEach((node, index) => {
      positions.set(node.id, {
        x: startX + index * (DETAIL_CARD_W + WORKFLOW_COL_GAP),
        y,
        w: DETAIL_CARD_W,
        h: DETAIL_CARD_H,
      });
    });
  }

  const internal: ProjectGraphEdge[] = [];
  const portGroups = new Map<
    string,
    { domain: string; direction: "out" | "in"; links: Set<string> }
  >();
  for (const edge of edges) {
    const sourceIn = domainOf.get(edge.source) === domain;
    const targetIn = domainOf.get(edge.target) === domain;
    if (sourceIn && targetIn) {
      internal.push(edge);
      continue;
    }
    if (!sourceIn && !targetIn) continue;
    const other = domainOf.get(sourceIn ? edge.target : edge.source);
    if (other === undefined) continue;
    const direction = sourceIn ? "out" : "in";
    const key = other + "\u0000" + direction;
    const group = portGroups.get(key) ?? { domain: other, direction, links: new Set<string>() };
    group.links.add(sourceIn ? edge.source : edge.target);
    portGroups.set(key, group);
  }

  let bounds = boundsOf(positions.values());
  const groups = [...portGroups.values()].toSorted(
    (a, b) => compareText(a.domain, b.domain) || compareText(a.direction, b.direction),
  );
  const out = groups.filter((group) => group.direction === "out");
  const inc = groups.filter((group) => group.direction === "in");
  const ports: SurfacePort[] = [];
  const stack = (groupList: typeof groups, x: number) => {
    groupList.forEach((group, index) => {
      ports.push({
        id: "port:" + group.direction + ":" + group.domain,
        domain: group.domain,
        direction: group.direction,
        rect: {
          x,
          y: (index - (groupList.length - 1) / 2) * PORT_PITCH - PORT_H / 2,
          w: PORT_W,
          h: PORT_H,
        },
        links: [...group.links].toSorted(compareText),
      });
    });
  };
  stack(out, bounds.x + bounds.w + PORT_OUT_OFFSET);
  stack(inc, bounds.x - PORT_IN_OFFSET);
  if (ports.length > 0)
    bounds = boundsOf([...positions.values(), ...ports.map((port) => port.rect)]);

  return { positions, headers, ports, edges: dedupeEdges(internal), bounds };
}
