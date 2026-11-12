// The project-graph view card: a declarative view (defineView under db/views) drawn as a schema
// object in the tables column, with its access mode, permission, the base tables the declaration
// names and whether any route uses it. Role tokens only (D-043/D-044); the geometry and the
// route usage live in graph-model.ts and graph-model-data.ts.

import type { NodeProps } from "@xyflow/react";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import Eye from "~icons/lucide/eye";
import { t, type MessageKey } from "@/i18n";
import { LinkHandles, UnknownBadge, nodeClass, sourceTitle } from "./ProjectGraphNodeChrome";
import type { ProjectAnalysisFlowNode } from "./ProjectGraphNodes";

const MAX_VISIBLE_TABLES = 4;

/** A definer view bypasses the invoker's RLS, so it carries the elevated warning role. */
function accessClass(access: "invoker" | "definer"): string {
  return access === "definer"
    ? "border-warning/50 bg-warning/10 text-warning"
    : "border-border bg-muted text-muted-foreground";
}

export function ViewGraphNode({ data, selected, dragging }: NodeProps<ProjectAnalysisFlowNode>) {
  const node = data.node;
  const view = node.data.kind === "view" ? node.data : null;
  if (view === null) return null;
  const shown = data.collapsed ? [] : view.tables.slice(0, MAX_VISIBLE_TABLES);
  const more = view.tables.length - shown.length;
  const used = view.usedByRoutes.length;
  return (
    <div
      data-testid="project-graph-view"
      title={sourceTitle(node)}
      className={nodeClass(selected, node.matched, dragging, data.focused) + " w-60"}
    >
      <div className="flex items-center gap-1.5">
        <Eye className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
          {view.view}
        </span>
        <span className="shrink-0 rounded border px-1 text-[8px] tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.node.view")}
        </span>
        {view.unknown && <UnknownBadge />}
        {view.tables.length > 0 && (
          <button
            type="button"
            className="nodrag flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent"
            aria-label={
              data.collapsed ? t("projectGraph.expandBases") : t("projectGraph.collapseBases")
            }
            title={data.collapsed ? t("projectGraph.expandBases") : t("projectGraph.collapseBases")}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleCollapse(node.id);
            }}
          >
            {data.collapsed ? (
              <ChevronRight className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </button>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px]">
        {view.access !== null && (
          <span className={"rounded border px-1 " + accessClass(view.access)}>
            {t(("projectGraph.access." + view.access) as MessageKey)}
          </span>
        )}
        <span
          title={
            view.permission === null
              ? undefined
              : t("projectGraph.permission", { permission: view.permission })
          }
          className={
            "min-w-0 max-w-full truncate rounded border px-1 font-mono " +
            (view.permission === null
              ? "text-muted-foreground"
              : "border-info/40 bg-info/10 text-info")
          }
        >
          {view.permission ?? t("projectGraph.public")}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px]">
        <span
          className={
            "rounded border px-1 " +
            (used > 0
              ? "border-success/50 bg-success/10 text-success"
              : "border-border text-muted-foreground")
          }
        >
          {used > 0 ? t("projectGraph.viewUsedBy", { count: used }) : t("projectGraph.viewUnused")}
        </span>
        {view.tables.length > 0 && (
          <span className="ml-auto shrink-0 text-muted-foreground">
            {t("projectGraph.viewTables", { count: view.tables.length })}
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t pt-1">
          {shown.map((table) => (
            <li key={table} className="truncate font-mono text-[9px] text-muted-foreground">
              {table}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="mt-0.5 text-[9px] text-muted-foreground">
          {t("projectGraph.moreTables", { count: more })}
        </p>
      )}
      <LinkHandles />
    </div>
  );
}
