// The project graph's "system" classification (D-163): what belongs to the framework's own
// feature surface rather than to the project's data surface, and is therefore what the graph's
// two visibility filters may hide. Pure and free of layout/IO so the view model and its tests can
// share it.
//
// Framework provenance is a fact for tables: the analyzer marks those whose declaration lives
// under `node_modules/`. The route side is a documented heuristic: the project's own routes are
// the ones that name a relation the project itself declares (a non-framework table or a view);
// routes that name none — auth, jobs, workflows, files — belong to the framework features the
// starter ships, and an unknown wrapper keeps an integrity node visible instead of guessing.

import type { ProjectGraphEdge, ProjectGraphNode } from "./graph-types";

const FRAMEWORK_SOURCE_PREFIX = "node_modules/";

/** A table declared by an installed @facilis.dev package (its source lives under node_modules/). */
export function isSystemTable(node: ProjectGraphNode): boolean {
  return node.data.kind === "table" && node.data.framework;
}

/** Names the project itself declares: non-framework tables and every view (views are project code). */
function projectRelationNames(nodes: readonly ProjectGraphNode[]): Set<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    if (node.data.kind === "table" && !node.data.framework) names.add(node.data.table);
    else if (node.data.kind === "view") names.add(node.data.view);
  }
  return names;
}

/** A route the project does not declare: framework source, or no project relation in dbTables. */
export function isSystemRoute(
  node: ProjectGraphNode,
  projectRelations: ReadonlySet<string>,
): boolean {
  if (node.data.kind !== "route") return false;
  // The graph is also the integrity view: an unreadable route is shown, never classified away.
  if (node.data.unknown) return false;
  if (node.sourceFile !== null && node.sourceFile.startsWith(FRAMEWORK_SOURCE_PREFIX)) return true;
  return node.data.dbTables.every((name) => !projectRelations.has(name));
}

/** The two independent filters, as the layout's view preferences store them. */
export interface SystemFilter {
  readonly routes: boolean;
  readonly tables: boolean;
}

/**
 * Ids the enabled filters remove from the drawn view. A system table the user's own routes use
 * stays (e.g. `facilis_files` reached from the todo routes); the framework tables only framework
 * routes touch disappear with those routes. Edges are dropped by the caller when an endpoint is
 * hidden, so this only decides nodes.
 */
export function hiddenSystemNodeIds(
  nodes: readonly ProjectGraphNode[],
  edges: readonly ProjectGraphEdge[],
  filter: SystemFilter,
): Set<string> {
  const hidden = new Set<string>();
  if (!filter.routes && !filter.tables) return hidden;
  const relations = projectRelationNames(nodes);
  const systemRoutes = new Set<string>();
  for (const node of nodes) {
    if (node.data.kind !== "route" || !isSystemRoute(node, relations)) continue;
    systemRoutes.add(node.id);
    if (filter.routes) hidden.add(node.id);
  }
  if (!filter.tables) return hidden;
  const usedByProjectRoutes = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "route-table" && edge.kind !== "route-view") continue;
    if (systemRoutes.has(edge.source)) continue;
    usedByProjectRoutes.add(edge.target);
  }
  for (const node of nodes) {
    if (isSystemTable(node) && !usedByProjectRoutes.has(node.id)) hidden.add(node.id);
  }
  return hidden;
}
