// The satellite's impact section (issue #74, epic #56 rule 1): the "Simulate removal" toggle,
// the affected routes grouped by HTTP method as a semantic, keyboard-reachable list, and the
// column-level affordance. Column impact is honest: with no dbColumns facts for the table the
// section says "column-level impact is not analysed" instead of inventing a cascade. The
// simulation is read-only — toggling changes the lens state, never the model. Role tokens only
// (D-044); every string via t() (D-043).

import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import { DetailsSection, EmptyNote, NodeSelectChip, SECTION_TITLE } from "./ProjectGraphDetailsSection";
import type { ImpactRouteGroup, ImpactSatellite } from "./useProjectGraphImpact";

export interface ProjectGraphImpactSectionProps {
  /** A table or view node; the section renders nothing for other kinds. */
  readonly node: ProjectGraphNode;
  readonly impact: ImpactSatellite;
  readonly nodeLabel: (id: string) => string | null;
  readonly onSelectNode: (id: string) => void;
}

/** The affected routes, grouped by method: native buttons in real lists, readable by AT. */
function ImpactRouteList({
  groups,
  nodeLabel,
  onSelectNode,
}: {
  groups: readonly ImpactRouteGroup[];
  nodeLabel: (id: string) => string | null;
  onSelectNode: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={t("projectGraph.impact.routes")} className="space-y-1">
      {groups.map((group) => (
        <div key={group.method}>
          <h4 className="font-mono text-[9px] font-semibold text-muted-foreground">
            {group.method}
          </h4>
          <ul
            className="flex flex-wrap gap-1"
            aria-label={t("projectGraph.impact.methodRoutes", { method: group.method })}
          >
            {group.routes.map((route) => (
              <li key={route.id}>
                <NodeSelectChip
                  id={route.id}
                  text={route.label}
                  nodeLabel={nodeLabel}
                  onSelect={onSelectNode}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ProjectGraphImpactSection({
  node,
  impact,
  nodeLabel,
  onSelectNode,
}: ProjectGraphImpactSectionProps) {
  if (node.data.kind !== "table" && node.data.kind !== "view") return null;
  const columns = node.data.kind === "table" ? node.data.columns : [];
  const result = impact.result;
  const isColumn = result !== null && "columnProperty" in result;
  return (
    <DetailsSection title={t("projectGraph.impact.section")}>
      <Button
        variant="outline"
        size="xs"
        data-testid="graph-impact-toggle"
        aria-pressed={impact.active}
        title={t("projectGraph.impact.simulateHint")}
        onClick={impact.onToggle}
      >
        <TriangleAlert />
        {impact.active ? t("projectGraph.impact.stop") : t("projectGraph.impact.simulate")}
      </Button>
      {impact.active && result !== null && (
        <p className="text-[10px] text-destructive" data-testid="graph-impact-counts">
          {isColumn
            ? t("projectGraph.focus.routes", { count: result.counts.routes })
            : t("projectGraph.impact.counts", {
                routes: result.counts.routes,
                views: result.counts.views,
              })}
        </p>
      )}
      {impact.active && result !== null && impact.routeGroups.length > 0 && (
        <ImpactRouteList
          groups={impact.routeGroups}
          nodeLabel={nodeLabel}
          onSelectNode={onSelectNode}
        />
      )}
      {impact.active && result !== null && impact.routeGroups.length === 0 && (
        <EmptyNote
          message={
            isColumn
              ? t("projectGraph.impact.columnNoDependents")
              : t("projectGraph.impact.noDependents")
          }
        />
      )}
      {node.data.kind === "table" && (
        <div className="space-y-1 border-t pt-1">
          <p className={SECTION_TITLE}>{t("projectGraph.impact.columns")}</p>
          {!impact.columnAnalysed && (
            <EmptyNote message={t("projectGraph.impact.columnNotAnalysed")} />
          )}
          <ul className="flex flex-wrap gap-1" aria-label={t("projectGraph.impact.columns")}>
            {columns.map((column) => {
              const active = impact.impactColumn === column.property;
              return (
                <li key={column.property}>
                  <button
                    type="button"
                    data-testid="graph-impact-column"
                    aria-pressed={active}
                    aria-label={t(
                      active
                        ? "projectGraph.impact.stopColumn"
                        : "projectGraph.impact.simulateColumn",
                      { column: column.property },
                    )}
                    className={
                      "max-w-full truncate rounded border px-1 font-mono text-[9px] " +
                      (active
                        ? "border-destructive/50 bg-destructive/10 text-destructive"
                        : "border-border text-muted-foreground hover:border-ring")
                    }
                    onClick={() => impact.onSimulateColumn(active ? null : column.property)}
                  >
                    {column.property}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </DetailsSection>
  );
}
