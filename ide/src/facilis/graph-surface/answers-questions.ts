// Questions answered from a page or a route (issue #190): Q1-Q4 and Q6 are navigational lists;
// Q5 lives with the table questions in answers-usage.ts.
import type { MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "../graph-types";
import { accessOfRoute, edgeSources, edgeTargets, mergeAccess } from "./answers-context";
import { domainOf, plainRow, rowOf, sorted } from "./answers-rows";
import type { GraphAnswerAccess, GraphAnswerContext, GraphAnswerRow } from "./answers-types";

/** Q1 — the routes a page calls (direct page-route edges). */
export function routesOfPage(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  if (node.kind !== "page") return [];
  const edges = ctx.outgoing.get(node.id)?.filter((edge) => edge.kind === "page-route");
  return edgeTargets(edges, ctx).map((route) =>
    rowOf(route, ctx, { access: accessOfRoute(route) }),
  );
}

/** Q2 — the pages that call a route (reverse page-route edges). */
export function pagesOfRoute(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  if (node.kind !== "route") return [];
  const edges = ctx.incoming.get(node.id)?.filter((edge) => edge.kind === "page-route");
  return edgeSources(edges, ctx).map((page) => rowOf(page, ctx));
}

/** Q3 — the transitive page -> route -> table/view set, tagged with how the route uses it. */
export function relationsOfPage(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  if (node.kind !== "page") return [];
  const access = new Map<string, GraphAnswerAccess>();
  for (const route of edgeTargets(
    ctx.outgoing.get(node.id)?.filter((edge) => edge.kind === "page-route"),
    ctx,
  )) {
    const routeAccess = accessOfRoute(route) ?? "read";
    for (const edge of ctx.outgoing.get(route.id) ?? []) {
      if (edge.kind !== "route-table" && edge.kind !== "route-view") continue;
      if (!ctx.byId.has(edge.target)) continue;
      access.set(edge.target, mergeAccess(access.get(edge.target) ?? null, routeAccess));
    }
  }
  const rows: GraphAnswerRow[] = [];
  for (const [id, use] of access) {
    const target = ctx.byId.get(id);
    if (target !== undefined) rows.push(rowOf(target, ctx, { access: use }));
  }
  return sorted(rows);
}

/** Q4 — routes that reach data through audited sudo/system elevation. Shares the lens labels. */
export function elevatedRoutes(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  const elevated = new Set(
    ctx.diagnostics.filter((entry) => entry.code === "elevated").map((entry) => entry.nodeId),
  );
  const ids = new Set<string>();
  if (node.kind === "route" && elevated.has(node.id)) ids.add(node.id);
  for (const edge of ctx.outgoing.get(node.id) ?? []) {
    if (edge.kind === "page-route" && elevated.has(edge.target)) ids.add(edge.target);
  }
  for (const edge of ctx.incoming.get(node.id) ?? []) {
    if (edge.kind !== "route-table" && edge.kind !== "route-view") continue;
    if (elevated.has(edge.source)) ids.add(edge.source);
  }
  const rows: GraphAnswerRow[] = [];
  for (const id of ids) {
    const route = ctx.byId.get(id);
    if (route === undefined) continue;
    const details = ctx.details.get(id);
    const detail =
      details?.kind === "route"
        ? details.route.elevations
            .map((elevation) => elevation.operation ?? elevation.tables.join(", "))
            .filter((text) => text.length > 0)
            .join(" · ")
        : "";
    rows.push(rowOf(route, ctx, { detail: detail.length > 0 ? detail : null }));
  }
  return sorted(rows);
}

/** Q6 — wrapper/permission overview plus the declared Zod input schemas. */
export function routeOverviewRows(
  node: ProjectGraphNode,
  ctx: GraphAnswerContext,
): GraphAnswerRow[] {
  if (node.data.kind !== "route") return [];
  const route = node.data;
  const rows: GraphAnswerRow[] = [
    plainRow("wrapper:" + node.id, "route", "projectGraph.surface.answers.wrapper", {
      domain: domainOf(node.id, ctx),
      detailKey: ("projectGraph.wrapper." + route.wrapper) as MessageKey,
    }),
    plainRow("permission:" + node.id, "route", "projectGraph.surface.answers.permission", {
      domain: domainOf(node.id, ctx),
      detail: route.permission.length > 0 ? route.permission.join(", ") : null,
      detailKey: route.permission.length > 0 ? null : "projectGraph.public",
    }),
  ];
  const inputs = ["body", "form", "query", "params"] as const;
  for (const input of inputs) {
    if (!route.input[input]) continue;
    rows.push(
      plainRow(
        "input:" + node.id + ":" + input,
        "input",
        ("projectGraph.input." + input) as MessageKey,
        { detailKey: "projectGraph.surface.answers.schemaPresent" },
      ),
    );
  }
  if (inputs.every((input) => !route.input[input])) {
    rows.push(plainRow("input:none:" + node.id, "input", "projectGraph.surface.answers.noInput"));
  }
  return rows;
}
