// The stats ribbon (issue #57): the old footer's counters, now a compact HUD cluster in the
// bottom-left zone, a flex child of the HUD dock row (issue #150): it hugs its content and wraps
// (min-w-0) within the space the zoom cluster leaves, so the two never overlap. Each counter is a
// filter button with an active state (aria-pressed): the five node-kind counters isolate kinds,
// the edges counter hides every edge. The lens chips (issue
// #63) dock beside the counters through the slot this module owns; the hidden-edges badge keeps
// the hidden count available when a chip alt-click hides a kind.

import { useContext, type ReactNode } from "react";
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
import { ImpactLensContext } from "./ProjectGraphImpactContext";
import { ProjectGraphImpactBar } from "./ProjectGraphImpactBar";

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
  runtimeControls,
  auditRibbon,
  dataRibbon,
  turnRibbon,
}: {
  stats: ProjectGraphStats | null;
  filter: GraphStatsFilter;
  onToggleKind: (kind: GraphNodeKind) => void;
  onToggleEdges: () => void;
  /** The lens chips (issue #63), docked in the bottom-left slot beside the counters. */
  lensChips: ReactNode;
  /** The runtime lens's control strip (issue #72), or null when the lens is inactive. */
  runtimeControls: ReactNode;
  /** The contract lens's audit ribbon (issue #69), or null when the lens is inactive. */
  auditRibbon: ReactNode;
  /** The data lens's summary ribbon (issue #70), or null when the lens is inactive. */
  dataRibbon: ReactNode;
  /** The agent lens's turn-diff segment (issue #73), or null when the lens is inactive. */
  turnRibbon: ReactNode;
}) {
  // The impact lens (issue #74) docks its aria-live line in this #150 row; the context gives it
  // the hook's HUD state without adding one prop to the HUD stack, and it renders null while
  // the lens is inactive so the ribbon is byte-identical.
  const impact = useContext(ImpactLensContext);
  return (
    <div
      data-testid="graph-hud-bottom-left"
      data-hud-zone
      className="pointer-events-auto flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm"
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
      {/* Runtime-lens controls slot (issue #72), the #69 audit-ribbon pattern. */}
      {runtimeControls}
      {/* Audit-ribbon slot (issue #69): the contract lens's four filter counters. */}
      {auditRibbon}
      {/* Data-ribbon slot (issue #70): the data lens's counters and stroke legend. */}
      {dataRibbon}
      {/* Turn-diff slot (issue #73): counters, base ref and the unmapped disclosure. */}
      {turnRibbon}
      {/* Impact slot (issue #74): the aria-live cascade counters and the exit affordance. */}
      {impact !== null && <ProjectGraphImpactBar hud={impact.hud} onExit={impact.exit} />}
    </div>
  );
}
