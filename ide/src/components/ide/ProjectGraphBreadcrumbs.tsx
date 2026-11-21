// The top-left HUD breadcrumb trail (issue #68): project → node in this base, each level a
// named button. The trail is data (graph-navigation.ts buildGraphBreadcrumbs): the cluster
// level slots in when sibling issue #62's drill contract merges — the item kind and the
// generic dispatch below already carry it, so no rewrite is needed then. The project root
// clears the selection and returns to the overview; the node level zooms and selects. Esc
// popping the node level is the EXISTING graphEscapeAction clear-selection step (composed in
// useProjectGraphPanelKeys), not a second escape path. Role tokens only (D-044), t() (D-043).

import { t } from "@/i18n";
import type { GraphBreadcrumbItem } from "@/facilis/graph-navigation";
import { Button } from "@/components/ui/button";

export interface ProjectGraphBreadcrumbsProps {
  readonly trail: readonly GraphBreadcrumbItem[];
  /** One dispatch for every level; the navigation hook resolves project vs node (vs #62 cluster). */
  readonly onNavigate: (item: GraphBreadcrumbItem) => void;
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
        const label =
          item.kind === "project" ? t("projectGraph.title") : (item.label ?? item.id ?? "");
        const ariaLabel =
          item.kind === "project"
            ? t("projectGraph.breadcrumbs.overviewHint")
            : t("projectGraph.breadcrumbs.nodeHint", { label });
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
