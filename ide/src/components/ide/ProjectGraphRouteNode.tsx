// The project-graph route card: the HTTP method, path, permission and wrapper state, the input
// flags and path parameters, and the route config's own one-sentence description (D-129). The
// description is project content in the project's language, not IDE chrome, so it is rendered
// verbatim instead of through t().

import type { RouteInputFact } from "@facilis.dev/analyze";
import type { NodeProps } from "@xyflow/react";
import Route from "~icons/lucide/route";
import { t, type MessageKey } from "@/i18n";
import { LinkHandles, UnknownBadge, nodeClass, sourceTitle } from "./ProjectGraphNodeChrome";
import type { ProjectAnalysisFlowNode } from "./ProjectGraphNodes";

function MethodBadge({ method }: { method: string }) {
  const tone =
    method === "GET"
      ? "border-info/40 bg-info/10 text-info"
      : method === "POST"
        ? "border-success/40 bg-success/10 text-success"
        : method === "PUT"
          ? "border-warning/40 bg-warning/10 text-warning"
          : method === "PATCH"
            ? "border-primary/40 bg-primary/10 text-primary"
            : method === "DELETE"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted text-muted-foreground";
  return (
    <span className={"shrink-0 rounded border px-1 py-0.5 font-mono text-[9px] font-bold " + tone}>
      {method}
    </span>
  );
}

const ROUTE_INPUTS: readonly { readonly fact: keyof RouteInputFact; readonly label: MessageKey }[] =
  [
    { fact: "body", label: "projectGraph.input.body" },
    { fact: "form", label: "projectGraph.input.form" },
    { fact: "query", label: "projectGraph.input.query" },
    { fact: "params", label: "projectGraph.input.params" },
  ];

export function RouteGraphNode({ data, selected, dragging }: NodeProps<ProjectAnalysisFlowNode>) {
  const node = data.node;
  const route = node.data.kind === "route" ? node.data : null;
  if (route === null) return null;
  // Defensive: a Fast-Refresh-preserved view or an analyzer worker started before the input
  // facts were added can still deliver the older RouteGraphData shape.
  const inputs = ROUTE_INPUTS.filter((entry) => route.input?.[entry.fact] === true);
  const pathParams = route.pathParams ?? [];
  const elevatedTables = [...new Set(route.elevations.flatMap((elevation) => elevation.tables))];
  // A missing value (an analyzer worker started before the field, or a Fast-Refresh-preserved
  // view) and a whitespace-only config string must both leave the card without a quote.
  const description = (route.description ?? "").trim();
  return (
    <div
      data-testid="project-graph-route"
      title={sourceTitle(node)}
      className={nodeClass(selected, node.matched, dragging) + " w-64"}
    >
      <div className="flex items-center gap-1.5">
        <MethodBadge method={route.method} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{route.path}</span>
        {route.unknown && <UnknownBadge />}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <Route className="size-2.5 shrink-0" />
        <span className="min-w-0 truncate">
          {route.permission.length === 0 ? t("projectGraph.public") : route.permission.join(", ")}
        </span>
        {route.elevations.length > 0 && (
          <span
            title={t("projectGraph.elevatedHint", {
              tables:
                elevatedTables.length === 0 ? t("projectGraph.unknown") : elevatedTables.join(", "),
            })}
            className="shrink-0 rounded border border-warning/50 bg-warning/10 px-1 text-warning"
          >
            {t("projectGraph.elevated")}
          </span>
        )}
        {route.wrapper !== "valid" && (
          <span
            className={
              "ml-auto shrink-0 rounded border px-1 " +
              (route.wrapper === "invalid"
                ? "border-destructive/50 text-destructive"
                : "border-warning/50 text-warning")
            }
          >
            {t(("projectGraph.wrapper." + route.wrapper) as MessageKey)}
          </span>
        )}
      </div>
      {description.length > 0 && (
        // Project content, not IDE chrome: the sentence stays in the project's language, so it
        // never goes through t() (D-129). line-clamp-2 keeps the card compact and the title
        // keeps the clamped sentence reachable.
        <p
          title={description}
          className="mt-1 line-clamp-2 border-l-2 border-muted-foreground/40 pl-1.5 text-[10px] leading-snug text-muted-foreground"
        >
          {description}
        </p>
      )}
      {(pathParams.length > 0 || inputs.length > 0) && (
        <div className="mt-1 flex flex-wrap items-center gap-1 border-t pt-1 text-[9px]">
          {pathParams.map((name) => (
            <span
              key={name}
              title={t("projectGraph.pathParam", { name })}
              className="rounded border border-info/40 bg-info/10 px-1 font-mono text-info"
            >
              {":" + name}
            </span>
          ))}
          {inputs.map((entry) => (
            <span
              key={entry.fact}
              className="rounded border border-border bg-muted px-1 text-muted-foreground"
            >
              {t(entry.label)}
            </span>
          ))}
        </div>
      )}
      <LinkHandles />
    </div>
  );
}
