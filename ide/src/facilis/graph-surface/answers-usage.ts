// Questions answered from a table/view or about any node's impact and provenance (issue #190):
// Q5, Q7-Q10, Q16, Q17. Q4/Q17 share the lens label and message keys so both entry points agree.
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { I18nParams } from "@facilis.dev/core/i18n";
import type { MessageKey } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types";
import { accessOfRoute, edgeSources, relationNameOf } from "./answers-context";
import { domainOf, plainRow, rowOf, sorted } from "./answers-rows";
import type { GraphAnswerContext, GraphAnswerRow, GraphAnswerSummary } from "./answers-types";
import { DIAGNOSTIC_LABEL_KEYS, DIAGNOSTIC_MESSAGE_KEYS, diagnosticParams } from "./lenses.ts";

const REFERENCE_KINDS: ReadonlySet<GraphEdgeKind> = new Set([
  "fk",
  "relation",
  "route-table",
  "route-view",
  "page-route",
  "page-link",
  "view-base",
]);

const EDGE_MESSAGE_KEYS: Readonly<Record<GraphEdgeKind, MessageKey>> = {
  fk: "projectGraph.edge.fk",
  relation: "projectGraph.edge.relation",
  "route-table": "projectGraph.edge.routeTable",
  "page-route": "projectGraph.edge.pageRoute",
  "page-link": "projectGraph.edge.pageLink",
  "route-view": "projectGraph.edge.routeView",
  "view-base": "projectGraph.edge.viewBase",
};

/** Q5 — a table's RLS class and its declared policies/grants. */
export function tableSecurityRows(
  node: ProjectGraphNode,
  ctx: GraphAnswerContext,
): GraphAnswerRow[] {
  if (node.data.kind !== "table") return [];
  const details = ctx.details.get(node.id);
  const policies =
    details?.kind === "table"
      ? details.table.policies
      : node.data.policies.map((policy) => ({ ...policy, command: "" }));
  return policies.map((policy) =>
    plainRow(
      "policy:" + node.id + ":" + policy.name,
      "policy",
      "projectGraph.surface.answers.kind.policy",
      {
        label: policy.name,
        labelKey: null,
        domain: domainOf(node.id, ctx),
        detail: policy.command.length > 0 ? policy.command : null,
        detailKey: policy.restrictive ? "projectGraph.flag.restrictive" : null,
      },
    ),
  );
}

export function tableSecuritySummary(node: ProjectGraphNode): GraphAnswerSummary | null {
  if (node.data.kind !== "table") return null;
  return {
    key: node.data.rlsEnabled
      ? "projectGraph.surface.answers.rls.enabled"
      : "projectGraph.surface.answers.rls.systemOnly",
    params: null,
  };
}

/** Q7 — routes that read/write a table, foreign keys pointing at it and views querying it. */
export function tableUsageRows(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  if (node.data.kind !== "table") return [];
  const incoming = ctx.incoming.get(node.id) ?? [];
  const routeRows = incoming
    .filter((edge) => edge.kind === "route-table")
    .flatMap((edge) => {
      const route = ctx.byId.get(edge.source);
      return route === undefined ? [] : [rowOf(route, ctx, { access: accessOfRoute(route) })];
    });
  const fkRows = incoming
    .filter((edge) => edge.kind === "fk")
    .flatMap((edge) => {
      const table = ctx.byId.get(edge.source);
      return table === undefined
        ? []
        : [rowOf(table, ctx, { detail: edge.label, detailKey: "projectGraph.edge.fk" })];
    });
  const viewRows = edgeSources(
    incoming.filter((edge) => edge.kind === "view-base"),
    ctx,
  ).map((view) => rowOf(view, ctx, { detailKey: "projectGraph.edge.viewBase" }));
  return sorted([...routeRows, ...fkRows, ...viewRows]);
}

/** Q8 — references from other domains, grouped, plus the views that query a table. */
export function externalReferences(
  node: ProjectGraphNode,
  ctx: GraphAnswerContext,
): GraphAnswerRow[] {
  const ownDomain = domainOf(node.id, ctx);
  const seen = new Map<string, ProjectGraphEdge>();
  const addEdges = (edges: readonly ProjectGraphEdge[] | undefined): void => {
    for (const edge of edges ?? []) {
      if (!REFERENCE_KINDS.has(edge.kind)) continue;
      const otherId = edge.source === node.id ? edge.target : edge.source;
      if (otherId === node.id || seen.has(otherId)) continue;
      const domain = domainOf(otherId, ctx);
      if (domain === null || domain === ownDomain) continue;
      seen.set(otherId, edge);
    }
  };
  addEdges(ctx.outgoing.get(node.id));
  addEdges(ctx.incoming.get(node.id));
  // A view over this table is a reference even when both live in the same domain.
  if (node.data.kind === "table") {
    for (const edge of ctx.incoming.get(node.id) ?? []) {
      if (edge.kind === "view-base" && !seen.has(edge.source)) seen.set(edge.source, edge);
    }
  }
  const rows: GraphAnswerRow[] = [];
  for (const [id, edge] of seen) {
    const other = ctx.byId.get(id);
    if (other === undefined) continue;
    rows.push(
      rowOf(other, ctx, {
        detailKey: EDGE_MESSAGE_KEYS[edge.kind],
        group: domainOf(id, ctx),
      }),
    );
  }
  return sorted(rows);
}

/** Q9 — which other domains reference this node, and how many links each contributes. */
export function sharedGroups(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  const ownDomain = domainOf(node.id, ctx);
  const tally = new Map<string, Map<string, number>>();
  const addEdges = (edges: readonly ProjectGraphEdge[] | undefined): void => {
    for (const edge of edges ?? []) {
      if (!REFERENCE_KINDS.has(edge.kind)) continue;
      const otherId = edge.source === node.id ? edge.target : edge.source;
      const domain = domainOf(otherId, ctx);
      if (otherId === node.id || domain === null || domain === ownDomain) continue;
      let counts = tally.get(domain);
      if (counts === undefined) {
        counts = new Map();
        tally.set(domain, counts);
      }
      counts.set(otherId, (counts.get(otherId) ?? 0) + 1);
    }
  };
  addEdges(ctx.outgoing.get(node.id));
  addEdges(ctx.incoming.get(node.id));
  if (tally.size < 2) return [];
  const rows: GraphAnswerRow[] = [];
  for (const [domain, counts] of tally) {
    for (const [id, count] of counts) {
      const other = ctx.byId.get(id);
      if (other === undefined) continue;
      rows.push(
        rowOf(other, ctx, {
          group: domain,
          detailKey: "projectGraph.surface.answers.references",
          detailParams: { count } satisfies I18nParams,
        }),
      );
    }
  }
  return sorted(rows);
}

/** Q10 — reverse closure: everything that breaks when this node is dropped. */
export function impactIfDropped(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  const visited = new Set<string>([node.id]);
  const queue: string[] = [node.id];
  const rows: GraphAnswerRow[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const edge of ctx.incoming.get(current) ?? []) {
      if (visited.has(edge.source)) continue;
      const dependent = ctx.byId.get(edge.source);
      if (dependent === undefined) continue;
      visited.add(edge.source);
      queue.push(edge.source);
      rows.push(rowOf(dependent, ctx, { group: domainOf(edge.source, ctx) }));
    }
  }
  // Workflows declare no edges (D-162): their table surface lives in the details join.
  const relation = relationNameOf(node);
  if (relation !== null) {
    for (const [id, details] of ctx.details) {
      if (details.kind !== "workflow" || !details.workflow.tables.includes(relation)) continue;
      if (visited.has(id)) continue;
      const workflow = ctx.byId.get(id);
      if (workflow === undefined) continue;
      visited.add(id);
      rows.push(
        rowOf(workflow, ctx, {
          group: domainOf(id, ctx),
          detailKey: "projectGraph.surface.answers.workflowUses",
        }),
      );
    }
  }
  return sorted(rows);
}

/** Q16 — the node's source file (and declaring line when the facts carry it). */
export function nodeSource(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  const details = ctx.details.get(node.id);
  const source =
    details === undefined
      ? null
      : details.kind === "route"
        ? details.route.source
        : details.kind === "table"
          ? details.table.source
          : details.kind === "page"
            ? details.page.source
            : details.kind === "view"
              ? details.view.source
              : details.workflow.source;
  const file = source?.file ?? node.sourceFile;
  if (file === null || file.length === 0) return [];
  const line = source?.line ?? null;
  return [
    {
      key: "source:" + node.id,
      nodeId: null,
      label: file,
      labelKey: null,
      labelParams: null,
      kind: "source",
      domain: domainOf(node.id, ctx),
      access: null,
      detail: null,
      detailKey:
        line === null
          ? "projectGraph.surface.answers.lineUnknown"
          : "projectGraph.surface.answers.line",
      detailParams: line === null ? null : { line },
      source: { file, line },
      group: null,
    },
  ];
}

/** Q17 — the analyzer's unknown-declaration findings for this node. Shares the lens labels. */
export function unknownFacts(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerRow[] {
  const rows: GraphAnswerRow[] = [];
  for (const entry of ctx.diagnostics) {
    if (entry.nodeId !== node.id || entry.code !== "unknown") continue;
    rows.push(
      plainRow("unknown:" + node.id, "unknown", DIAGNOSTIC_LABEL_KEYS[entry.code], {
        domain: domainOf(node.id, ctx),
        detailKey: DIAGNOSTIC_MESSAGE_KEYS[entry.code],
        detailParams: diagnosticParams(entry),
      }),
    );
  }
  return rows;
}
