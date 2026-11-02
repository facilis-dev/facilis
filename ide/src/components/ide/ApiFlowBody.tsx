// The API Flow body: the loading/error/empty states and the graph-or-list switch, split
// from ApiFlowPanel.tsx to keep both files under the 300-line limit.

import RefreshCw from "~icons/lucide/refresh-cw";
import Workflow from "~icons/lucide/workflow";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { ApiFlowResult } from "@/facilis/api-flow-client";
import type {
  ApiFlowGraph,
  ApiFlowSelection,
  ApiPageNode,
  ApiRouteNode,
} from "@/facilis/api-flow-model";
import { ApiFlowContent } from "./ApiFlowContent";
import { ApiFlowList } from "./ApiFlowList";

interface BodyProps {
  base: string | null;
  result: ApiFlowResult | null;
  loading: boolean;
  graph: ApiFlowGraph | null;
  query: string;
  view: "graph" | "list";
  selected: ApiFlowSelection | null;
  linksDisabled: boolean;
  onRetry: () => void;
  onSelect: (selection: ApiFlowSelection) => void;
  onOpenRoute: (node: ApiRouteNode) => void;
  onOpenPage: (node: ApiPageNode) => void;
  onOpenTable: () => void;
}

export function ApiFlowBody({
  base,
  result,
  loading,
  graph,
  query,
  view,
  selected,
  linksDisabled,
  onRetry,
  onSelect,
  onOpenRoute,
  onOpenPage,
  onOpenTable,
}: BodyProps) {
  if (base === null) {
    return <Empty title={t("apiFlow.unreachable")} body={t("apiFlow.unreachableHint")} />;
  }
  if (result === null && loading) {
    return (
      <p className="flex items-center gap-1.5 px-2 py-2 text-[11px] text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" />
        {t("apiFlow.loading")}
      </p>
    );
  }
  if (result !== null && !result.ok) {
    return (
      <div className="m-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
        <p className="font-medium text-destructive">
          {t("apiFlow.error", { error: result.error })}
        </p>
        <Button variant="ghost" size="xs" className="mt-1" onClick={onRetry}>
          {t("apiFlow.retry")}
        </Button>
      </div>
    );
  }
  if (graph === null) return null;
  if (graph.routes.length === 0 && query.trim().length > 0) {
    return <Empty title={t("apiFlow.noMatch")} body={t("apiFlow.emptyHint")} />;
  }
  if (graph.stats.routes === 0) {
    return (
      <Empty
        title={t("apiFlow.empty")}
        body={graph.openapiUnavailable ? t("apiFlow.openapiDisabled") : t("apiFlow.emptyHint")}
      />
    );
  }
  if (view === "list") {
    return (
      <ApiFlowList
        graph={graph}
        linksDisabled={linksDisabled}
        onOpenRoute={onOpenRoute}
        onOpenPage={onOpenPage}
      />
    );
  }
  return (
    <ApiFlowContent
      graph={graph}
      selected={selected}
      onSelect={onSelect}
      onOpenRoute={onOpenRoute}
      onOpenPage={onOpenPage}
      onOpenTable={onOpenTable}
      linksDisabled={linksDisabled}
    />
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <Workflow className="size-5 text-muted-foreground" />
      <p className="text-xs font-medium">{title}</p>
      <p className="text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}
