// The collapsed graph filters (#182): edge kinds and table visibility behind one "Filters"
// button with a count badge. The five chip rows used to wrap inside a normal side panel and
// left the canvas ~150px tall; the canvas now owns the height and the badge keeps the active
// filtering visible even when the menu is closed.

import SlidersHorizontal from "~icons/lucide/sliders-horizontal";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t, type MessageKey } from "@/i18n";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { GRAPH_EDGE_KINDS, type GraphTableVisibility } from "@/facilis/graph-layout";
import { GRAPH_EDGE_LABEL_KEYS, GRAPH_EDGE_STYLES } from "./project-graph-edges";

/** The owner's order: narrowest first, "all" last. */
const TABLE_VISIBILITY_OPTIONS: readonly GraphTableVisibility[] = ["project", "used", "all"];
const DEFAULT_TABLE_VISIBILITY: GraphTableVisibility = "project";

const TABLE_VISIBILITY_LABEL_KEYS: Record<GraphTableVisibility, MessageKey> = {
  project: "projectGraph.tableVisibility.project",
  used: "projectGraph.tableVisibility.used",
  all: "projectGraph.tableVisibility.all",
};

export function ProjectGraphFiltersMenu({
  hiddenEdgeKinds,
  tableVisibility,
  onToggleEdgeKind,
  onTableVisibilityChange,
}: {
  hiddenEdgeKinds: readonly GraphEdgeKind[];
  tableVisibility: GraphTableVisibility;
  onToggleEdgeKind: (kind: GraphEdgeKind, hidden: boolean) => void;
  onTableVisibilityChange: (visibility: GraphTableVisibility) => void;
}) {
  const activeFilters =
    hiddenEdgeKinds.length + (tableVisibility === DEFAULT_TABLE_VISIBILITY ? 0 : 1);
  const resetFilters = () => {
    for (const kind of GRAPH_EDGE_KINDS) {
      if (hiddenEdgeKinds.includes(kind)) onToggleEdgeKind(kind, false);
    }
    onTableVisibilityChange(DEFAULT_TABLE_VISIBILITY);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="project-graph-filters"
        aria-label={t("projectGraph.filters.button")}
        title={t("projectGraph.filters.button")}
        className="inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent data-[popup-open]:bg-accent"
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="hidden @sm:inline">{t("projectGraph.filters.button")}</span>
        {activeFilters > 0 && (
          <span
            data-testid="project-graph-filters-count"
            className="rounded bg-brand/15 px-1 text-[9px] font-medium text-brand"
          >
            {activeFilters}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {/* Base UI's GroupLabel throws outside a Menu.Group (issue #52). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("projectGraph.filters")}</DropdownMenuLabel>
          {GRAPH_EDGE_KINDS.map((kind) => (
            <DropdownMenuCheckboxItem
              key={kind}
              data-testid={"project-graph-filter-" + kind}
              checked={!hiddenEdgeKinds.includes(kind)}
              onCheckedChange={(checked) => onToggleEdgeKind(kind, !checked)}
            >
              <span
                className="inline-block h-0.5 w-3 shrink-0 rounded"
                style={{ background: GRAPH_EDGE_STYLES[kind].stroke }}
              />
              {t(GRAPH_EDGE_LABEL_KEYS[kind])}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("projectGraph.tableVisibility")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={tableVisibility}
            onValueChange={(value) => {
              if (typeof value === "string") {
                onTableVisibilityChange(value as GraphTableVisibility);
              }
            }}
          >
            {TABLE_VISIBILITY_OPTIONS.map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {t(TABLE_VISIBILITY_LABEL_KEYS[value])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {activeFilters > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetFilters}>
              {t("projectGraph.filters.reset")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
