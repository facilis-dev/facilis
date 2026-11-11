/**
 * Route handler -> relation usage (D-157), the pass that makes `dbTables` an applied
 * declaration: what a route reaches through `ctx.db` and the audited `ctx.sudo`/`ctx.system`
 * callback clients is compared with what it declares, tables and views alike.
 *
 * The walk lives in route-relations-walk.ts / route-relations-follow.ts and the diagnostics in
 * route-relations-diagnostics.ts (300-line split). A route with an invalid wrapper keeps an
 * explicitly empty usage: the wrapper error is the finding, not a guessed relation set.
 */

import { callArguments, unwrapExpression } from "../ast/node.ts";
import type { ModuleGraph } from "../module-graph.ts";
import type { RouteFact, TableFact, ViewFact, Diagnostic } from "../types.ts";
import { EMPTY_ROUTE_RELATIONS, type RouteRelationsFact } from "../types-relations.ts";
import { createRelationIndex } from "./route-relation-resolve.ts";
import { routeRelationDiagnostics } from "./route-relations-diagnostics.ts";
import { scanHandlerUsage } from "./route-relations-walk.ts";
import { resolveWrapperCall } from "./routes.ts";

export interface RouteRelationsScan {
  readonly routes: readonly RouteFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function handlerOf(
  call: ReturnType<typeof resolveWrapperCall>,
): ReturnType<typeof unwrapExpression> {
  if (call === null) return undefined;
  return unwrapExpression(callArguments(call)[1]);
}

/** Attach relation-usage facts to every scannable route and derive the D-157 diagnostics. */
export function buildRouteRelationFacts(
  graph: ModuleGraph,
  routes: readonly RouteFact[],
  tables: readonly TableFact[],
  views: readonly ViewFact[],
): RouteRelationsScan {
  const index = createRelationIndex(tables, views);
  const enriched: RouteFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const route of routes) {
    const file = graph.file(route.sourceFile);
    const handler =
      file === undefined || route.wrapper !== "valid"
        ? undefined
        : handlerOf(resolveWrapperCall(file));
    if (
      file === undefined ||
      handler === undefined ||
      (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression")
    ) {
      const relations: RouteRelationsFact = EMPTY_ROUTE_RELATIONS;
      enriched.push({ ...route, relations });
      continue;
    }
    const relations = scanHandlerUsage(graph, file, handler, index);
    enriched.push({ ...route, relations });
    diagnostics.push(...routeRelationDiagnostics(route, relations));
  }
  return { routes: enriched, diagnostics };
}
