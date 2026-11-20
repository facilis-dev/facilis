// The stats ribbon (issue #57): the old footer counters and the old toolbar edge filters
// consolidated into one floating HUD cluster. Every kind counter is a filter toggle with
// aria-pressed; the logic lives in graph-ribbon-filters.ts. Node-kind toggles are view-only
// (positions never move, nothing enters the layout file); edge-kind toggles drive the
// persisted hiddenEdges exactly like the checkboxes they replace. Role tokens only (D-044).

import Info from "~icons/lucide/info";
import type { Diagnostic, GraphEdgeKind, GraphNodeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphStats } from "@/facilis/graph-types";
import { GRAPH_EDGE_KINDS } from "@/facilis/graph-types";
import {
  ELEVATED_EDGE_STYLE,
  GRAPH_EDGE_LABEL_KEYS,
  GRAPH_EDGE_STYLES,
} from "./project-graph-edges";
import { GRAPH_NODE_KINDS, allEdgeKindsHidden } from "./graph-ribbon-filters";

export interface ProjectGraphStatsRibbonProps {
  readonly stats: ProjectGraphStats | null;
  readonly edgeTotals: Record<GraphEdgeKind, number>;
  readonly hiddenEdgeKinds: readonly GraphEdgeKind[];
  readonly hiddenNodeKinds: readonly GraphNodeKind[];
  readonly onToggleEdgeKind: (kind: GraphEdgeKind, hidden: boolean) => void;
  readonly onToggleNodeKind: (kind: GraphNodeKind) => void;
  readonly onToggleAllEdges: () => void;
  readonly queryActive: boolean;
  readonly layoutInvalid: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

const NODE_COUNT_KEYS: Record<GraphNodeKind, keyof ProjectGraphStats> = {
  page: "pages",
  route: "routes",
  table: "tables",
  view: "views",
  workflow: "workflows",
};

function severityClass(severity: Diagnostic["severity"]): string {
  return severity === "error"
    ? "text-destructive"
    : severity === "warning"
      ? "text-warning"
      : "text-muted-foreground";
}

function FilterChip({
  pressed,
  onClick,
  testId,
  label,
  count,
  dot,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  testId: string;
  label: string;
  count: number;
  dot?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={
        "flex items-center gap-1 rounded border px-1.5 py-0.5 " +
        (pressed
          ? "border-border bg-card text-foreground hover:bg-accent"
          : "border-border/60 text-muted-foreground opacity-60 hover:opacity-90")
      }
    >
      {dot !== undefined && (
        <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: dot }} />
      )}
      <span>{label}</span>
      <span className="font-mono">{count}</span>
    </button>
  );
}

export function ProjectGraphStatsRibbon({
  stats,
  edgeTotals,
  hiddenEdgeKinds,
  hiddenNodeKinds,
  onToggleEdgeKind,
  onToggleNodeKind,
  onToggleAllEdges,
  queryActive,
  layoutInvalid,
  diagnostics,
}: ProjectGraphStatsRibbonProps) {
  if (stats === null && !layoutInvalid && diagnostics.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t("projectGraph.statsRibbon")}
      data-testid="project-graph-stats-ribbon"
      className="flex max-w-full flex-wrap items-center gap-1 rounded-md border border-border bg-popover/95 px-1.5 py-1 text-[10px] text-muted-foreground shadow-md"
    >
      {layoutInvalid && (
        <p className="w-full rounded border border-warning/40 bg-warning/5 px-1.5 py-0.5 text-warning">
          {t("projectGraph.layoutInvalid")}
        </p>
      )}
      {stats !== null && (
        <>
          {GRAPH_NODE_KINDS.map((kind) => (
            <FilterChip
              key={kind}
              testId={"project-graph-filter-" + kind}
              pressed={!hiddenNodeKinds.includes(kind)}
              label={t(("projectGraph.node." + kind) as MessageKey)}
              count={stats[NODE_COUNT_KEYS[kind]]}
              onClick={() => onToggleNodeKind(kind)}
            />
          ))}
          <FilterChip
            testId="project-graph-filter-edges"
            pressed={!allEdgeKindsHidden(hiddenEdgeKinds)}
            label={t("projectGraph.filters")}
            count={stats.edges}
            title={t("projectGraph.edgesToggleHint")}
            onClick={onToggleAllEdges}
          />
          {GRAPH_EDGE_KINDS.map((kind) => (
            <FilterChip
              key={kind}
              testId={"project-graph-filter-" + kind}
              pressed={!hiddenEdgeKinds.includes(kind)}
              label={t(GRAPH_EDGE_LABEL_KEYS[kind])}
              count={edgeTotals[kind]}
              dot={GRAPH_EDGE_STYLES[kind].stroke}
              onClick={() => onToggleEdgeKind(kind, !hiddenEdgeKinds.includes(kind))}
            />
          ))}
          <span className="flex items-center gap-1" title={t("projectGraph.edge.elevated")}>
            <span
              className="inline-block h-0.5 w-3 shrink-0 rounded"
              style={{ background: ELEVATED_EDGE_STYLE.stroke }}
            />
            {t("projectGraph.statsElevated", { count: stats.elevatedEdges })}
          </span>
          {stats.pageLinks > 0 && (
            <span>{t("projectGraph.statsPageLinks", { count: stats.pageLinks })}</span>
          )}
          {stats.unknownNodes > 0 && (
            <span className="rounded border border-warning/50 px-1 text-warning">
              {t("projectGraph.unknownNodes", { count: stats.unknownNodes })}
            </span>
          )}
          {stats.hiddenEdges > 0 && (
            <span>{t("projectGraph.hiddenEdges", { count: stats.hiddenEdges })}</span>
          )}
          {stats.hiddenNodes > 0 && (
            <span>{t("projectGraph.hiddenNodes", { count: stats.hiddenNodes })}</span>
          )}
          {queryActive && <span>{t("projectGraph.matches", { count: stats.matches })}</span>}
          <span title={t("projectGraph.hint")} className="flex items-center">
            <Info className="size-3" />
          </span>
        </>
      )}
      <details className="w-full">
        <summary className="cursor-pointer select-none">
          {t("projectGraph.diagnostics")} ({diagnostics.length})
        </summary>
        {diagnostics.length === 0 ? (
          <p className="mt-0.5">{t("projectGraph.diagnosticsNone")}</p>
        ) : (
          <ul className="mt-0.5 max-h-24 space-y-0.5 overflow-y-auto">
            {diagnostics.map((diagnostic, index) => (
              <li key={diagnostic.code + ":" + index} className="flex items-start gap-1">
                <span className={"shrink-0 font-mono " + severityClass(diagnostic.severity)}>
                  {t(("projectGraph.severity." + diagnostic.severity) as MessageKey)}
                </span>
                <span className="min-w-0 flex-1 truncate" title={diagnostic.message}>
                  {diagnostic.code} — {diagnostic.message}
                </span>
                {diagnostic.source !== null && (
                  <span className="shrink-0 font-mono">
                    {t("projectGraph.diagnosticSource", {
                      file: diagnostic.source.file,
                      line: diagnostic.source.line,
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
