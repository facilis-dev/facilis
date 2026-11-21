// The inspector's runtime section (issue #72): count, error rate, p50/p95 and the 60-bucket
// sparkline for the selected window, on the existing floating details surface (epic rule 1 —
// no new panel). When #59's satellite lands it will host this section; until then the inspector
// does. A null percentile renders an explicit "beyond measurable range" — never a fabricated 0
// (epic rule 5: unknown is first-class). No traffic is the muted empty state, never green.
//
// Like the card marks, the section binds the store's per-route source: live on repaints it with
// the batch, live off it reads the last snapshot on each user action (selection, window change).

import { useMemo, useSyncExternalStore } from "react";
import { t, type MessageKey } from "@/i18n";
import {
  RUNTIME_SPARK_BUCKETS,
  getRuntimeLensStore,
  normalizeRouteTemplate,
  type RuntimeWindow,
} from "@/facilis/graph-runtime";
import type { RouteGraphData } from "@/facilis/graph-types";
import { DetailsSection, EmptyNote } from "./ProjectGraphDetailsSection";

function Sparkline({ spark, label }: { spark: readonly number[]; label: string }) {
  // Scale to the busiest bucket (at least 1 so an all-zero window draws a flat baseline).
  const max = Math.max(1, ...spark);
  return (
    <svg
      data-testid="runtime-sparkline"
      viewBox={`0 0 ${RUNTIME_SPARK_BUCKETS} 16`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-8 w-full text-info"
    >
      {spark.map((count, index) => {
        const height = count === 0 ? 0 : Math.max(0.5, (count / max) * 16);
        return (
          <rect
            key={index}
            x={index + 0.1}
            y={16 - height}
            width={0.8}
            height={height}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

/** Null percentiles are an explicit unknown, never a fabricated 0 (epic rule 5). */
function latency(value: number | null): string {
  return value === null ? t("projectGraph.runtime.unbounded") : value + " ms";
}

export function ProjectGraphRuntimeSection({
  route,
  window: currentWindow,
}: {
  route: RouteGraphData;
  window: RuntimeWindow;
}) {
  const store = getRuntimeLensStore();
  const template = normalizeRouteTemplate(route.path);
  const source = useMemo(
    () => store.routeSource(template, currentWindow),
    [store, template, currentWindow],
  );
  const view = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getServerSnapshot);
  const stats = view.stats;
  const windowLabel = t(("projectGraph.runtime.window." + currentWindow) as MessageKey);
  return (
    <DetailsSection title={t("projectGraph.runtime.section")}>
      {stats === null ? (
        <EmptyNote message={t("projectGraph.runtime.empty")} />
      ) : (
        <div data-testid="inspector-runtime" className="space-y-1">
          <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
            <dt className="text-muted-foreground">{t("projectGraph.runtime.requests")}</dt>
            <dd data-testid="runtime-stat-count" className="tabular-nums">
              {stats.count}
            </dd>
            <dt className="text-muted-foreground">{t("projectGraph.runtime.errorRate")}</dt>
            <dd
              data-testid="runtime-stat-error-rate"
              className={"tabular-nums " + (stats.errors > 0 ? "text-destructive" : "")}
            >
              {Math.round(stats.errorRate * 100)}%
            </dd>
            <dt className="text-muted-foreground">{t("projectGraph.runtime.p50")}</dt>
            <dd data-testid="runtime-stat-p50">{latency(stats.p50Ms)}</dd>
            <dt className="text-muted-foreground">{t("projectGraph.runtime.p95")}</dt>
            <dd data-testid="runtime-stat-p95">{latency(stats.p95Ms)}</dd>
          </dl>
          {(stats.clientErrors > 0 || stats.aborted > 0) && (
            <p data-testid="runtime-stat-other" className="text-[9px] text-muted-foreground">
              {stats.clientErrors > 0 &&
                t("projectGraph.runtime.clientErrors", { count: stats.clientErrors })}
              {stats.clientErrors > 0 && stats.aborted > 0 && " · "}
              {stats.aborted > 0 && t("projectGraph.runtime.aborted", { count: stats.aborted })}
            </p>
          )}
          <Sparkline
            spark={view.spark}
            label={t("projectGraph.runtime.sparkline", { window: windowLabel })}
          />
        </div>
      )}
    </DetailsSection>
  );
}
