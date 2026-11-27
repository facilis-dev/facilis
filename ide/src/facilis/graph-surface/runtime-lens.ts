// The runtime lens's facts (D-224, Q18): per-route samples from the dev-only collector,
// normalised to state facts and draw-only badges. Pure: it reads a snapshot and a view and
// never touches the layout, so a badge cannot move or resize a card.

import { t } from "@/i18n";
import type { ProjectGraphView } from "../graph-model";
import { routeKeyOf, type RouteRuntimeMetrics } from "../runtime-metrics";
import { ROUTE_WINDOW_MS } from "../runtime-metrics-buffer";
import type { GraphLensBadge } from "./lenses.ts";
import type { GraphLensState, GraphStateFact } from "./state-facts.ts";

/** p95 above this is a slow route; documented here so the legend and the fact agree. */
export const SLOW_ROUTE_P95_MS = 500;
export const RUNTIME_WINDOW_MINUTES = Math.round(ROUTE_WINDOW_MS / 60_000);

interface RouteNodeRef {
  readonly nodeId: string;
  readonly method: string;
  readonly path: string;
}

function routeNodesOf(view: ProjectGraphView | null): readonly RouteNodeRef[] {
  const nodes: RouteNodeRef[] = [];
  for (const node of view?.nodes ?? []) {
    if (node.data.kind !== "route") continue;
    nodes.push({ nodeId: node.id, method: node.data.method, path: node.data.path });
  }
  return nodes;
}

/** The template paths the preview client must match; the enable list and the graph agree. */
export function runtimeRouteTemplates(view: ProjectGraphView | null): readonly string[] {
  const paths = new Set<string>();
  for (const node of routeNodesOf(view)) paths.add(node.path);
  return Array.from(paths).sort();
}

function badgeColor(errors: number, slow: boolean): string {
  if (errors > 0) return "--destructive";
  return slow ? "--warning" : "--success";
}

/**
 * Map the collector's rows onto graph route nodes. Rows whose method+template has no node
 * are dropped: the graph only explains routes it drew, and assets/HMR never reach here.
 */
export function buildRuntimeLensState(
  rows: readonly RouteRuntimeMetrics[],
  view: ProjectGraphView | null,
): GraphLensState {
  const byKey = new Map<string, string>();
  for (const node of routeNodesOf(view)) byKey.set(routeKeyOf(node.method, node.path), node.nodeId);
  const facts: GraphStateFact[] = [];
  const badges = new Map<string, GraphLensBadge>();
  let requests = 0;
  let errors = 0;
  for (const row of rows) {
    const nodeId = byKey.get(routeKeyOf(row.method, row.route));
    if (nodeId === undefined) continue;
    requests += row.count;
    errors += row.errors;
    if (row.count === 0) continue;
    const slow = row.p95Ms !== null && row.p95Ms >= SLOW_ROUTE_P95_MS;
    if (row.errors > 0) {
      const rate = Math.round((row.errors / row.count) * 100);
      facts.push({
        nodeId,
        code: "state.routeErrors",
        params: { errors: row.errors, total: row.count, rate },
      });
    }
    if (slow && row.p95Ms !== null) {
      facts.push({
        nodeId,
        code: "state.slowRoute",
        params: { p95: row.p95Ms, threshold: SLOW_ROUTE_P95_MS },
      });
    }
    badges.set(nodeId, {
      text: t("projectGraph.surface.state.badge", { requests: row.count, errors: row.errors }),
      colorToken: badgeColor(row.errors, slow),
    });
  }
  return {
    facts,
    totals: {
      key: "projectGraph.surface.state.totals",
      count: requests,
      params: { errors },
    },
    params: { minutes: RUNTIME_WINDOW_MINUTES },
    contextKey: "projectGraph.surface.state.window",
    emptyKey: requests === 0 ? "projectGraph.surface.state.noTraffic" : null,
    badges,
  };
}
