// The HUD "actions and filters" menu (issue #57): the old toolbar's second row (seven edge-kind
// filters, table visibility) plus the layout actions (add note, reset), folded into one dropdown
// so the floating top-right cluster stays compact. Role tokens only (D-044); every label via t().
// Each labelled section sits in a Group: Base UI's GroupLabel throws outside one (issue #52).

import RotateCcw from "~icons/lucide/rotate-ccw";
import SlidersHorizontal from "~icons/lucide/sliders-horizontal";
import StickyNote from "~icons/lucide/sticky-note";
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
import type { ProjectGraphStats } from "@/facilis/graph-model";
import { GRAPH_EDGE_LABEL_KEYS, GRAPH_EDGE_STYLES } from "./project-graph-edges";

/** The owner's order: narrowest first, "all" last (D-179). */
const TABLE_VISIBILITY_OPTIONS: readonly GraphTableVisibility[] = ["project", "used", "all"];

const TABLE_VISIBILITY_LABEL_KEYS: Record<GraphTableVisibility, MessageKey> = {
  project: "projectGraph.tableVisibility.project",
  used: "projectGraph.tableVisibility.used",
  all: "projectGraph.tableVisibility.all",
};

function isTableVisibility(value: unknown): value is GraphTableVisibility {
  return value === "project" || value === "used" || value === "all";
}

export function ProjectGraphHudActions({
  stats,
  hiddenEdgeKinds,
  onToggleEdgeKind,
  tableVisibility,
  onTableVisibilityChange,
  onAddNote,
  onResetLayout,
}: {
  stats: ProjectGraphStats | null;
  hiddenEdgeKinds: readonly GraphEdgeKind[];
  onToggleEdgeKind: (kind: GraphEdgeKind, hidden: boolean) => void;
  tableVisibility: GraphTableVisibility;
  onTableVisibilityChange: (visibility: GraphTableVisibility) => void;
  onAddNote: () => void;
  onResetLayout: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="graph-hud-actions"
        aria-label={t("projectGraph.actionsMenu")}
        title={t("projectGraph.actionsMenu")}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-accent aria-expanded:text-foreground"
      >
        <SlidersHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={stats === null} onClick={onAddNote}>
            <StickyNote />
            {t("projectGraph.addNote")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={stats === null} onClick={onResetLayout}>
            <RotateCcw />
            {t("projectGraph.resetLayout")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("projectGraph.filters")}</DropdownMenuLabel>
          {GRAPH_EDGE_KINDS.map((kind) => (
            <DropdownMenuCheckboxItem
              key={kind}
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
            onValueChange={(value: unknown) => {
              if (isTableVisibility(value)) onTableVisibilityChange(value);
            }}
          >
            {TABLE_VISIBILITY_OPTIONS.map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {t(TABLE_VISIBILITY_LABEL_KEYS[value])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-[11px] text-muted-foreground">{t("projectGraph.hint")}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
