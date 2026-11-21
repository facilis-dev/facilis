// The top-left HUD breadcrumb trail (issue #68): project → cluster → node, each level a named
// button. The trail is data (graph-navigation.ts buildGraphBreadcrumbs), so the #62 drill level
// and the shared selection render from the same contract the navigation hook dispatches.
// The project root clears the selection, leaves the drill and refits the overview; a cluster
// crumb drops the selection inside that cluster; the node level zooms and selects. Esc popping
// a level is the EXISTING graphEscapeAction ladder, not a second escape path. Role tokens
// only (D-044), t() (D-043); every level is a button, so the pointer and Enter agree (rule 6).

import { t } from "@/i18n";
import { OTHER_CLUSTER_KEY } from "@/facilis/graph-clusters";
import type { GraphBreadcrumbItem } from "@/facilis/graph-navigation";
import { Button } from "@/components/ui/button";

export interface ProjectGraphBreadcrumbsProps {
  readonly trail: readonly GraphBreadcrumbItem[];
  /** One dispatch for every level; the navigation hook resolves project vs cluster vs node. */
  readonly onNavigate: (item: GraphBreadcrumbItem) => void;
}

/** The cluster level shows the analyzer-derived label, "Other" for the ungrouped bucket. */
function itemLabel(item: GraphBreadcrumbItem): string {
  if (item.kind === "project") return t("projectGraph.title");
  if (item.kind === "cluster" && item.label === OTHER_CLUSTER_KEY) {
    return t("projectGraph.cluster.other");
  }
  return item.label ?? item.id ?? "";
}

function itemHint(item: GraphBreadcrumbItem, label: string): string {
  if (item.kind === "project") return t("projectGraph.breadcrumbs.overviewHint");
  if (item.kind === "cluster") return t("projectGraph.breadcrumbs.clusterHint", { label });
  return t("projectGraph.breadcrumbs.nodeHint", { label });
}

export function ProjectGraphBreadcrumbs({ trail, onNavigate }: ProjectGraphBreadcrumbsProps) {
  return (
    <nav
      aria-label={t("projectGraph.breadcrumbs.label")}
      data-testid="graph-breadcrumbs"
      className="flex min-w-0 items-center gap-0.5"
    >
      {trail.map((item, index) => {
        const isLast = index === trail.length - 1;
        const label = itemLabel(item);
        const ariaLabel = itemHint(item, label);
        return (
          <span
            key={item.kind + ":" + (item.id ?? "root")}
            className="flex min-w-0 items-center gap-0.5"
          >
            {index > 0 && (
              <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
                ›
              </span>
            )}
            <Button
              variant="ghost"
              size="xs"
              data-testid={"graph-breadcrumb-" + item.kind}
              aria-label={ariaLabel}
              aria-current={isLast ? "location" : undefined}
              title={ariaLabel}
              className="max-w-40 truncate text-xs font-medium"
              onClick={() => onNavigate(item)}
            >
              {label}
            </Button>
          </span>
        );
      })}
    </nav>
  );
}
