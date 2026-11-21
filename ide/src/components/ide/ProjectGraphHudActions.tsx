// The HUD actions menu (issue #57): the layout actions (add note, reset) and table visibility,
// folded into one dropdown so the floating top-right cluster stays compact. The seven edge-kind
// filters moved to the canvas lens chips (issue #63). Role tokens only (D-044); every label via
// t(). Each labelled section sits in a Group: Base UI's GroupLabel throws outside one (issue #52).

import RotateCcw from "~icons/lucide/rotate-ccw";
import SlidersHorizontal from "~icons/lucide/sliders-horizontal";
import StickyNote from "~icons/lucide/sticky-note";
import {
  DropdownMenu,
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
import type { GraphTableVisibility } from "@/facilis/graph-layout";
import type { ProjectGraphStats } from "@/facilis/graph-model";

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
  tableVisibility,
  onTableVisibilityChange,
  onAddNote,
  onResetLayout,
}: {
  stats: ProjectGraphStats | null;
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
