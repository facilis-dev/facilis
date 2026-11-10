// The project-graph footer: the counts, the legend, the interaction hint, a warning when
// the saved layout could not be read, and the analyzer diagnostics. Split from the panel to
// keep both files well under the 300-line source limit.

import type { Diagnostic } from "@facilis/analyze";
import { t, type MessageKey } from "@/i18n";
import { GRAPH_EDGE_KINDS } from "@/facilis/graph-layout";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import {
  ELEVATED_EDGE_STYLE,
  GRAPH_EDGE_LABEL_KEYS,
  GRAPH_EDGE_STYLES,
} from "./project-graph-edges";

function severityClass(severity: Diagnostic["severity"]): string {
  return severity === "error"
    ? "text-destructive"
    : severity === "warning"
      ? "text-warning"
      : "text-muted-foreground";
}

export function ProjectGraphFooter({
  stats,
  diagnostics,
  layoutInvalid,
}: {
  stats: ProjectGraphStats | null;
  diagnostics: readonly Diagnostic[];
  layoutInvalid: boolean;
}) {
  return (
    <div className="shrink-0 space-y-1 border-t px-2 py-1.5 text-[10px] text-muted-foreground">
      {layoutInvalid && (
        <p className="rounded border border-warning/40 bg-warning/5 px-1.5 py-1 text-warning">
          {t("projectGraph.layoutInvalid")}
        </p>
      )}
      {stats !== null && (
        <p>
          {t("projectGraph.stats", {
            pages: stats.pages,
            routes: stats.routes,
            tables: stats.tables,
            edges: stats.edges,
          })}
          {stats.pageLinks > 0 && (
            <>
              {" · "}
              {t("projectGraph.statsPageLinks", { count: stats.pageLinks })}
            </>
          )}
          {stats.elevatedEdges > 0 && (
            <>
              {" · "}
              {t("projectGraph.statsElevated", { count: stats.elevatedEdges })}
            </>
          )}
        </p>
      )}
      {stats !== null && (
        <ul className="flex flex-wrap items-center gap-1">
          <li className="font-medium text-foreground">{t("projectGraph.legend")}</li>
          {(["page", "route", "table"] as const).map((kind) => (
            <li key={kind} className="rounded border px-1">
              {t(("projectGraph.node." + kind) as MessageKey)}
            </li>
          ))}
          {GRAPH_EDGE_KINDS.map((kind) => (
            <li key={kind} className="flex items-center gap-1 rounded border px-1">
              <span
                className="inline-block h-0.5 w-3 shrink-0 rounded"
                style={{ background: GRAPH_EDGE_STYLES[kind].stroke }}
              />
              {t(GRAPH_EDGE_LABEL_KEYS[kind])}
            </li>
          ))}
          <li className="flex items-center gap-1 rounded border px-1">
            <span
              className="inline-block h-0.5 w-3 shrink-0 rounded"
              style={{ background: ELEVATED_EDGE_STYLE.stroke }}
            />
            {t("projectGraph.edge.elevated")}
          </li>
          {stats.unknownNodes > 0 && (
            <li className="rounded border border-warning/50 px-1 text-warning">
              {t("projectGraph.unknownNodes", { count: stats.unknownNodes })}
            </li>
          )}
        </ul>
      )}
      {stats !== null && <p>{t("projectGraph.hint")}</p>}
      <details>
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
