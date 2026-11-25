// Row constructors shared by the answer modules (issue #190). Pure: a row carries data plus
// the i18n key the component resolves, never a translated string.
import type { MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "../graph-types";
import type { GraphAnswerContext, GraphAnswerKind, GraphAnswerRow } from "./answers-types";

export function domainOf(id: string, ctx: GraphAnswerContext): string | null {
  return ctx.domainOf.get(id) ?? null;
}

export function rowOf(
  node: ProjectGraphNode,
  ctx: GraphAnswerContext,
  extra: Partial<GraphAnswerRow> = {},
): GraphAnswerRow {
  return {
    key: node.id,
    nodeId: node.id,
    label: node.label,
    labelKey: null,
    labelParams: null,
    kind: node.kind,
    domain: domainOf(node.id, ctx),
    access: null,
    detail: null,
    detailKey: null,
    detailParams: null,
    source: null,
    group: null,
    ...extra,
  };
}

export function sorted(rows: GraphAnswerRow[]): GraphAnswerRow[] {
  return rows.toSorted(
    (a, b) =>
      (a.group ?? "").localeCompare(b.group ?? "") ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key),
  );
}

export function plainRow(
  key: string,
  kind: GraphAnswerKind,
  labelKey: MessageKey,
  options: Partial<GraphAnswerRow> = {},
): GraphAnswerRow {
  return {
    key,
    nodeId: null,
    label: "",
    labelKey,
    labelParams: null,
    kind,
    domain: null,
    access: null,
    detail: null,
    detailKey: null,
    detailParams: null,
    source: null,
    group: null,
    ...options,
  };
}
