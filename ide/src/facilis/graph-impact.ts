// The impact simulation lens (issue #74, epic #56): "what breaks if I drop this table/column?".
// Pure like graph-reachability.ts: the cascade runs over the VISIBLE view's edges only, so every
// highlighted edge exists in ProjectGraphView (criterion 3) — the lens never invents a fact and
// never touches the model. Cycle-safe (visited sets), deterministic (sorted ids), and total:
// stale deep-link ids degrade to null / "not analysed", never throw.
//
// Column-level impact consumes the analyzer's dbColumns declarations through the existing
// graph-details join (routeId → dbColumns, "table.property" with the Drizzle PROPERTY key).
// Those are declarations, not a full reference analysis: when no route declares any column of
// the table the honest answer is { analysed: false }, a first-class visible state (epic rule 5).

import type { NodeDetails } from "./graph-details";
import type { ProjectGraphView } from "./graph-types";

/** The dependents of removing one table or view; the target itself is named separately. */
export interface RemovalImpact {
  readonly targetId: string;
  /** Sorted dependent ids: routes (direct, elevated included, and via views) plus broken views. */
  readonly affectedNodeIds: readonly string[];
  /** Sorted ids of edges present in the view that the removal would break. */
  readonly brokenEdgeIds: readonly string[];
  /** Routes and views counted separately; a route reached twice counts once. */
  readonly counts: { readonly routes: number; readonly views: number };
}

/** Column impact is either an honest unknown or the declaring routes' cascade. */
export type ColumnImpact =
  | { readonly analysed: false }
  | {
      readonly analysed: true;
      readonly targetId: string;
      readonly columnProperty: string;
      readonly affectedNodeIds: readonly string[];
      readonly brokenEdgeIds: readonly string[];
      readonly counts: { readonly routes: number; readonly views: number };
    };

/** The analysed column result shares the removal shape so one overlay serves both. */
export type AnalysedColumnImpact = Extract<ColumnImpact, { analysed: true }>;

const sorted = (ids: Iterable<string>): string[] => [...ids].toSorted((a, b) => a.localeCompare(b));

/**
 * The removal cascade for a TABLE or VIEW target, or null when the id is absent or names
 * another kind (a stale deep link degrades to "no simulation", never dims against a ghost).
 * A table breaks its direct routes (elevated included), the views declared on it and the
 * routes reading those views; views on views cascade transitively. A view breaks its reading
 * routes and any view declared on it.
 */
export function computeRemovalImpact(view: ProjectGraphView, targetId: string): RemovalImpact | null {
  const target = view.nodes.find((node) => node.id === targetId);
  if (target === undefined || (target.kind !== "table" && target.kind !== "view")) return null;
  const kinds = new Map(view.nodes.map((node) => [node.id, node.kind]));

  // Broken schema objects: the target plus every view transitively declared on a broken one
  // (upstream over view-base). The visited set is what makes a view-on-view cycle terminate.
  const brokenObjects = new Set<string>([targetId]);
  const queue: string[] = [targetId];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    for (const edge of view.edges) {
      if (edge.kind !== "view-base" || edge.target !== current) continue;
      if (kinds.get(edge.source) !== "view" || brokenObjects.has(edge.source)) continue;
      brokenObjects.add(edge.source);
      queue.push(edge.source);
    }
  }

  const routes = new Set<string>();
  for (const edge of view.edges) {
    if (kinds.get(edge.source) !== "route") continue;
    if (edge.kind === "route-table" && edge.target === targetId) routes.add(edge.source);
    if (edge.kind === "route-view" && brokenObjects.has(edge.target)) routes.add(edge.source);
  }
  const views = new Set([...brokenObjects].filter((id) => id !== targetId));
  const affectedNodeIds = sorted([...routes, ...views]);
  // Only edges the view actually draws: filtering view.edges is what guarantees criterion 3.
  const brokenEdgeIds = sorted(
    view.edges
      .filter(
        (edge) =>
          (edge.kind === "route-table" && edge.target === targetId) ||
          (edge.kind === "view-base" &&
            (edge.source === targetId || brokenObjects.has(edge.target))) ||
          (edge.kind === "route-view" && brokenObjects.has(edge.target)),
      )
      .map((edge) => edge.id),
  );
  return {
    targetId,
    affectedNodeIds,
    brokenEdgeIds,
    counts: { routes: routes.size, views: views.size },
  };
}

/**
 * Tables no route reads, directly (route-table, elevated included) or through a view
 * (route-view + the view-base chain). The lens shows them with a muted badge — an observation
 * about the declared surface, not a claim that the table is unused at runtime.
 */
export function neverReadTableIds(view: ProjectGraphView): readonly string[] {
  const kinds = new Map(view.nodes.map((node) => [node.id, node.kind]));
  const read = new Set<string>();
  const readViews = new Set<string>();
  for (const edge of view.edges) {
    if (edge.kind === "route-table") read.add(edge.target);
    if (edge.kind === "route-view") readViews.add(edge.target);
  }
  // Flood downstream over view-base from every read view; a view on a view carries the read.
  const visited = new Set(readViews);
  const queue = [...readViews];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    for (const edge of view.edges) {
      if (edge.kind !== "view-base" || edge.source !== current) continue;
      if (kinds.get(edge.target) === "table") read.add(edge.target);
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);
      queue.push(edge.target);
    }
  }
  return sorted(
    view.nodes.filter((node) => node.kind === "table" && !read.has(node.id)).map((node) => node.id),
  );
}

/** The routeId → dbColumns slice of the existing details join; no fact extraction happens here. */
export function columnFactsFromDetails(
  details: ReadonlyMap<string, NodeDetails>,
): ReadonlyMap<string, readonly string[]> {
  const facts = new Map<string, readonly string[]>();
  for (const [id, entry] of details) {
    if (entry.kind === "route") facts.set(id, entry.route.dbColumns);
  }
  return facts;
}

/**
 * Whether any visible route declares a dbColumns entry for the table at all — the difference
 * between "analysed, nothing declares this column" and the honest unknown (epic rule 5).
 */
export function tableColumnFactsExist(
  view: ProjectGraphView,
  tableId: string,
  columnFacts: ReadonlyMap<string, readonly string[]>,
): boolean {
  const table = view.nodes.find((node) => node.id === tableId);
  if (table === undefined || table.data.kind !== "table") return false;
  const prefix = table.data.table + ".";
  const visibleRoutes = new Set(
    view.nodes.filter((node) => node.kind === "route").map((node) => node.id),
  );
  for (const [routeId, entries] of columnFacts) {
    if (visibleRoutes.has(routeId) && entries.some((entry) => entry.startsWith(prefix))) {
      return true;
    }
  }
  return false;
}

/**
 * Column impact for one Drizzle property of a table. When no visible route declares ANY
 * dbColumns entry for the table the answer is { analysed: false } — the honest unknown, not
 * "nothing breaks". Otherwise the dependents are exactly the routes declaring
 * "<table>.<property>" (the property key per SPEC §dbColumns; SQL-name spellings are not
 * guessed), and the broken edges are the view's own route-table edges from those routes.
 */
export function computeColumnImpact(
  view: ProjectGraphView,
  tableId: string,
  columnProperty: string,
  columnFacts: ReadonlyMap<string, readonly string[]>,
): ColumnImpact {
  const table = view.nodes.find((node) => node.id === tableId);
  if (table === undefined || table.data.kind !== "table") return { analysed: false };
  if (!tableColumnFactsExist(view, tableId, columnFacts)) return { analysed: false };
  const prefix = table.data.table + ".";
  // Iterate the view's routes, not the facts map: a stale fact id must not name a ghost node.
  const routes = new Set<string>();
  for (const node of view.nodes) {
    if (node.kind !== "route") continue;
    const entries = columnFacts.get(node.id);
    if (entries !== undefined && entries.includes(prefix + columnProperty)) routes.add(node.id);
  }
  const brokenEdgeIds = sorted(
    view.edges
      .filter(
        (edge) => edge.kind === "route-table" && edge.target === tableId && routes.has(edge.source),
      )
      .map((edge) => edge.id),
  );
  return {
    analysed: true,
    targetId: tableId,
    columnProperty,
    affectedNodeIds: sorted(routes),
    brokenEdgeIds,
    counts: { routes: routes.size, views: 0 },
  };
}

/** The canvas overlay: a pure function of (view, result), so exiting restores exactly. */
export interface ImpactOverlay {
  /** The simulated node, or null when the lens is active without a suitable selection. */
  readonly targetId: string | null;
  /** Target + dependents: the cards that keep their colour while the rest dims. */
  readonly keepNodeIds: ReadonlySet<string>;
  readonly brokenEdgeIds: ReadonlySet<string>;
  readonly neverReadTableIds: ReadonlySet<string>;
}

/**
 * The overlay for the active simulation, or the badge-only overlay (no target, no dimming)
 * when the lens is active without a result. Never-read badges show whenever the lens is on.
 */
export function impactOverlay(
  view: ProjectGraphView,
  result: RemovalImpact | AnalysedColumnImpact | null,
): ImpactOverlay {
  const neverRead = new Set(neverReadTableIds(view));
  if (result === null) {
    return {
      targetId: null,
      keepNodeIds: new Set(),
      brokenEdgeIds: new Set(),
      neverReadTableIds: neverRead,
    };
  }
  return {
    targetId: result.targetId,
    keepNodeIds: new Set([result.targetId, ...result.affectedNodeIds]),
    brokenEdgeIds: new Set(result.brokenEdgeIds),
    neverReadTableIds: neverRead,
  };
}
