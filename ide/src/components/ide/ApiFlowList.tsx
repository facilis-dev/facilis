// The API Flow list view (D-087): the same graph data as a compact table, which is easier
// to scan than a graph when a project has many routes. Routes first, then the pages that
// call them, both clickable to open the file.

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { type ApiFlowGraph, type ApiPageNode, type ApiRouteNode } from "@/facilis/api-flow-model";
import { METHOD_BADGES } from "./api-flow-badges";

interface ListProps {
  graph: ApiFlowGraph;
  linksDisabled: boolean;
  onOpenRoute: (node: ApiRouteNode) => void;
  onOpenPage: (node: ApiPageNode) => void;
}

export function ApiFlowList({ graph, linksDisabled, onOpenRoute, onOpenPage }: ListProps) {
  if (graph.routes.length === 0 && graph.pages.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">{t("apiFlow.noMatch")}</p>;
  }
  return (
    <div data-testid="api-flow-list" className="h-full overflow-y-auto px-2 py-2 text-xs">
      <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("apiFlow.legendRoute")}
      </h3>
      <ul className="space-y-1">
        {graph.routes.map((route) => {
          const consumers = route.data.consumers;
          return (
            <li key={route.id}>
              <button
                type="button"
                disabled={linksDisabled}
                onClick={() => onOpenRoute(route)}
                title={t("apiFlow.openRoute", { route: route.data.method + " " + route.data.path })}
                className="w-full rounded-md border bg-card px-2 py-1 text-left hover:border-ring disabled:cursor-default"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={
                      "shrink-0 rounded border px-1 py-0.5 font-mono text-[9px] font-bold " +
                      METHOD_BADGES[route.data.method]
                    }
                  >
                    {route.data.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {route.data.path}
                  </span>
                  {route.data.unused && (
                    <span className="shrink-0 rounded border border-warning/50 px-1 text-[9px] text-warning">
                      {t("apiFlow.list.unused")}
                    </span>
                  )}
                  <span className="shrink-0 text-muted-foreground">
                    {t("apiFlow.consumersCount", { count: consumers.length })}
                  </span>
                </span>
                {consumers.length > 0 && (
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                    {consumers.map((consumer) => consumer.path).join(", ")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {graph.pages.length > 0 && (
        <>
          <h3 className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("apiFlow.legendPage")}
          </h3>
          <ul className="space-y-1">
            {graph.pages.map((page) => (
              <li key={page.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={linksDisabled}
                  onClick={() => onOpenPage(page)}
                  title={t("apiFlow.openPage", { path: page.data.path })}
                  className="h-auto w-full justify-start gap-1.5 px-2 py-1 text-left"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {page.data.path}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t("apiFlow.pageRoutes", { count: page.data.routeCount })}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
