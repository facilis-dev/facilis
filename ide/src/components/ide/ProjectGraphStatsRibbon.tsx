// The stats ribbon (issue #57): the old footer's counters, now a compact HUD cluster in the
// bottom-left zone. Each counter is a filter button with an active state (aria-pressed): the five
// node-kind counters isolate kinds, the edges counter hides every edge. The lens chips (issue
// #63) dock beside the counters through the slot this module owns; the hidden-edges badge keeps
// the hidden count available when a chip alt-click hides a kind.

import type { ReactNode } from "react";
import Eye from "~icons/lucide/eye";
import File from "~icons/lucide/file";
import GitBranch from "~icons/lucide/git-branch";
import Route from "~icons/lucide/route";
import Table from "~icons/lucide/table";
import Workflow from "~icons/lucide/workflow";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphStats } from "@/facilis/graph-model";
import { isKindActive, type GraphStatsFilter } from "@/facilis/graph-stats-filter";
import { Button } from "@/components/ui/button";

const KIND_ICONS: Record<GraphNodeKind, typeof File> = {
  page: File,
  route: Route,
  table: Table,
  view: Eye,
  workflow: Workflow,
};

const KIND_LABEL_KEYS: Record<GraphNodeKind, MessageKey> = {
  page: "projectGraph.ribbon.pages",
  route: "projectGraph.ribbon.routes",
  table: "projectGraph.ribbon.tables",
  view: "projectGraph.ribbon.views",
  workflow: "projectGraph.ribbon.workflows",
};

const KIND_STAT_KEY: Record<GraphNodeKind, keyof ProjectGraphStats> = {
  page: "pages",
  route: "routes",
  table: "tables",
  view: "views",
  workflow: "workflows",
};

const KIND_ORDER: readonly GraphNodeKind[] = ["page", "route", "table", "view", "workflow"];

export function ProjectGraphStatsRibbon({
  stats,
  filter,
  onToggleKind,
  onToggleEdges,
  lensChips,
}: {
  stats: ProjectGraphStats | null;
  filter: GraphStatsFilter;
  onToggleKind: (kind: GraphNodeKind) => void;
  onToggleEdges: () => void;
  /** The lens chips (issue #63), docked in the bottom-left slot beside the counters. */
  lensChips: ReactNode;
}) {
  return (
    <div
      data-testid="graph-hud-bottom-left"
      data-hud-zone
      className="pointer-events-auto absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm"
    >
      <div
        role="toolbar"
        aria-label={t("projectGraph.ribbon.label")}
        data-testid="graph-stats-ribbon"
        className="flex flex-wrap items-center gap-0.5"
      >
        {KIND_ORDER.map((kind) => {
          const Icon = KIND_ICONS[kind];
          const label = t(KIND_LABEL_KEYS[kind]);
          const active = isKindActive(filter, kind);
          const count = stats === null ? 0 : stats[KIND_STAT_KEY[kind]];
          return (
            <Button
              key={kind}
              variant="ghost"
              size="xs"
              data-testid={"graph-stat-" + kind}
              aria-pressed={active}
              aria-label={t("projectGraph.ribbon.filterKind", { label })}
              title={t("projectGraph.ribbon.filterKind", { label })}
              disabled={stats === null}
              className={active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}
              onClick={() => onToggleKind(kind)}
            >
              <Icon />
              <span className="tabular-nums text-foreground">{count}</span>
              <span className="hidden xl:inline">{label}</span>
            </Button>
          );
        })}
        <Button
          variant="ghost"
          size="xs"
          data-testid="graph-stat-edges"
          aria-pressed={filter.edgesHidden}
          aria-label={t("projectGraph.ribbon.filterEdges")}
          title={t("projectGraph.ribbon.filterEdges")}
          disabled={stats === null}
          className={
            filter.edgesHidden ? "bg-accent text-accent-foreground" : "text-muted-foreground"
          }
          onClick={onToggleEdges}
        >
          <GitBranch />
          <span className="tabular-nums text-foreground">{stats?.edges ?? 0}</span>
          <span className="hidden xl:inline">{t("projectGraph.ribbon.edges")}</span>
          {stats !== null && stats.hiddenEdges > 0 ? (
            <span
              data-testid="graph-hidden-count"
              className="rounded border border-border px-0.5 text-[9px] tabular-nums"
            >
              {t("projectGraph.hiddenEdges", { count: stats.hiddenEdges })}
            </span>
          ) : null}
        </Button>
      </div>
      {/* Lens-chips slot (issue #57), filled by issue #63. */}
      {lensChips}
    </div>
  );
}
