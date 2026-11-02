// The API Flow inspector (D-087): the details of the selected node. Kept beside the canvas
// instead of inside the node cards, which is what lets the cards stay compact and readable.

import ChevronRight from "~icons/lucide/chevron-right";
import X from "~icons/lucide/x";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import {
  type ApiFlowGraph,
  type ApiFlowSelection,
  type ApiPageNode,
  type ApiRouteNode,
} from "@/facilis/api-flow-model";
import { METHOD_BADGES } from "./api-flow-badges";

interface InspectorProps {
  graph: ApiFlowGraph;
  selection: ApiFlowSelection;
  linksDisabled: boolean;
  onClose: () => void;
  onOpenRoute: (node: ApiRouteNode) => void;
  onOpenPage: (node: ApiPageNode) => void;
  onOpenTable: () => void;
}

export function ApiFlowInspector({
  graph,
  selection,
  linksDisabled,
  onClose,
  onOpenRoute,
  onOpenPage,
  onOpenTable,
}: InspectorProps) {
  return (
    <aside
      data-testid="api-flow-inspector"
      aria-label={t("apiFlow.inspector.title")}
      className="absolute inset-y-0 right-0 z-10 flex w-80 max-w-full flex-col border-l bg-editor shadow-lg"
    >
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <span className="text-xs font-medium">{t("apiFlow.inspector.title")}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("apiFlow.inspector.close")}
          title={t("apiFlow.inspector.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-xs">
        {selection.kind === "route" && (
          <RouteDetails
            graph={graph}
            id={selection.id}
            linksDisabled={linksDisabled}
            onOpenRoute={onOpenRoute}
          />
        )}
        {selection.kind === "page" && (
          <PageDetails
            graph={graph}
            id={selection.id}
            linksDisabled={linksDisabled}
            onOpenPage={onOpenPage}
          />
        )}
        {selection.kind === "table" && (
          <TableDetails
            graph={graph}
            id={selection.id}
            linksDisabled={linksDisabled}
            onOpenTable={onOpenTable}
          />
        )}
      </div>
    </aside>
  );
}

function RouteDetails({
  graph,
  id,
  linksDisabled,
  onOpenRoute,
}: {
  graph: ApiFlowGraph;
  id: string;
  linksDisabled: boolean;
  onOpenRoute: (node: ApiRouteNode) => void;
}) {
  const node = graph.routes.find((entry) => entry.id === id);
  if (node === undefined) return <p className="text-muted-foreground">{t("apiFlow.noMatch")}</p>;
  const tables = graph.edges
    .filter((edge) => edge.source === id)
    .map((edge) => graph.tables.find((table) => table.id === edge.target)?.data.name)
    .filter((name): name is string => name !== undefined);
  const data = node.data;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span
          className={
            "rounded border px-1 py-0.5 font-mono text-[10px] font-bold " +
            METHOD_BADGES[data.method]
          }
        >
          {data.method}
        </span>
        <span className="break-all font-mono text-[11px]">{data.path}</span>
      </div>
      {data.summary !== null && <p className="text-muted-foreground">{data.summary}</p>}
      {data.unused && (
        <p className="rounded border border-warning/50 bg-warning/10 p-1 text-warning">
          {t("apiFlow.inspector.unused")}
        </p>
      )}
      {data.permission.length > 0 && (
        <Section label={t("apiFlow.inspector.permission")}>{data.permission.join(", ")}</Section>
      )}
      {tables.length > 0 && (
        <Section label={t("apiFlow.inspector.tables")}>{tables.join(", ")}</Section>
      )}
      <Section label={t("apiFlow.inspector.usedBy")}>
        {data.consumers.length === 0 ? (
          <span className="text-muted-foreground">{t("apiFlow.inspector.noConsumers")}</span>
        ) : (
          <ul className="space-y-0.5">
            {data.consumers.map((consumer) => (
              <li key={consumer.path + (consumer.via ?? "")} className="break-all font-mono">
                {consumer.path}
                {consumer.via !== null && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {t("apiFlow.inspector.via", { module: consumer.via })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {data.sourceFile !== null && (
        <Section label={t("apiFlow.inspector.source")}>{data.sourceFile}</Section>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="secondary"
          size="xs"
          disabled={linksDisabled || data.sourceFile === null}
          onClick={() => onOpenRoute(node)}
        >
          {t("apiFlow.inspector.open")}
        </Button>
      </div>
    </div>
  );
}

function PageDetails({
  graph,
  id,
  linksDisabled,
  onOpenPage,
}: {
  graph: ApiFlowGraph;
  id: string;
  linksDisabled: boolean;
  onOpenPage: (node: ApiPageNode) => void;
}) {
  const node = graph.pages.find((entry) => entry.id === id);
  if (node === undefined) return <p className="text-muted-foreground">{t("apiFlow.noMatch")}</p>;
  const routes = graph.edges
    .filter((edge) => edge.source === id)
    .map((edge) => graph.routes.find((route) => route.id === edge.target))
    .filter((route): route is NonNullable<typeof route> => route !== undefined);
  return (
    <div className="space-y-2">
      <p className="break-all font-mono text-[11px]">{node.data.path}</p>
      <Section label={t("apiFlow.inspector.page")}>{node.data.kind}</Section>
      {node.data.via !== null && (
        <p className="break-all text-muted-foreground">
          {t("apiFlow.inspector.via", { module: node.data.via })}
        </p>
      )}
      <Section label={t("apiFlow.inspector.routesUsed")}>
        <ul className="space-y-0.5">
          {routes.map((route) => (
            <li key={route.id} className="font-mono">
              {route.data.method} {route.data.path}
            </li>
          ))}
        </ul>
      </Section>
      <Button
        variant="secondary"
        size="xs"
        disabled={linksDisabled}
        onClick={() => onOpenPage(node)}
      >
        {t("apiFlow.inspector.open")}
      </Button>
    </div>
  );
}

function TableDetails({
  graph,
  id,
  linksDisabled,
  onOpenTable,
}: {
  graph: ApiFlowGraph;
  id: string;
  linksDisabled: boolean;
  onOpenTable: () => void;
}) {
  const node = graph.tables.find((entry) => entry.id === id);
  if (node === undefined) return <p className="text-muted-foreground">{t("apiFlow.noMatch")}</p>;
  const routes = graph.edges
    .filter((edge) => edge.target === id)
    .map((edge) => graph.routes.find((route) => route.id === edge.source))
    .filter((route): route is NonNullable<typeof route> => route !== undefined);
  return (
    <div className="space-y-2">
      <p className="font-mono text-[11px]">{node.data.name}</p>
      <Section label={t("apiFlow.inspector.columns")}>{node.data.columnCount}</Section>
      <Section label={t("apiFlow.inspector.usedBy")}>
        <ul className="space-y-0.5">
          {routes.map((route) => (
            <li key={route.id} className="font-mono">
              {route.data.method} {route.data.path}
            </li>
          ))}
        </ul>
      </Section>
      <Button variant="secondary" size="xs" disabled={linksDisabled} onClick={onOpenTable}>
        {t("apiFlow.inspector.open")}
      </Button>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <ChevronRight className="size-3" />
        {label}
      </p>
      <div className="pl-3.5 text-foreground">{children}</div>
    </div>
  );
}
