// The compact card's single badge row (issue #60), split from ProjectGraphLod.tsx for the
// 300-line source limit. Every badge is an analyzer fact carried by the view model — the RLS
// exception, the wrapper state, the unknown flag — never a guess (epic rule 5). Role tokens
// only (D-043/D-044); the font size is inherited from the counter-scaled badge row.

import type { ReactNode } from "react";
import { t, type MessageKey } from "@/i18n";
import { lodScreenPx } from "@/facilis/graph-lod";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import type { TurnNodeChrome } from "@/facilis/graph-turn-diff";

/** One compact badge; the font size is inherited from the counter-scaled badge row. */
export function GraphLodBadge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={"shrink-0 rounded border px-[0.25em] " + tone}
      style={{ paddingLeft: lodScreenPx(3), paddingRight: lodScreenPx(3) }}
    >
      {children}
    </span>
  );
}

const NEUTRAL = "border-border text-muted-foreground";
const WARNING = "border-warning/50 text-warning";
const INFO = "border-info/40 text-info";
const SUCCESS = "border-success/50 text-success";

/**
 * The one badge row of the compact card: first the agent lens's M/A mark (issue #73) — at this
 * LOD the git status is the turn's most decisive fact — then the kind's own facts. GraphLodBadge
 * counter-scales the row, so it stays above the 7 px floor at every zoom (epic rule 4).
 */
export function compactBadges(
  node: ProjectGraphNode,
  turn: TurnNodeChrome | null = null,
): ReactNode {
  const badge =
    turn === null ? null : (
      // A secondary agent lens fades its own mark, never the kind's facts (epic rule 3).
      <span style={turn.secondary ? { opacity: 0.3 } : undefined}>
        <GraphLodBadge tone={turn.kind === "modified" ? WARNING : SUCCESS}>
          {turn.kind === "modified" ? "M" : "A"}
        </GraphLodBadge>
      </span>
    );
  return (
    <>
      {badge}
      {kindBadges(node)}
    </>
  );
}

/** The kind's most decision-relevant facts, without any lens mark. */
function kindBadges(node: ProjectGraphNode): ReactNode {
  const data = node.data;
  switch (data.kind) {
    case "page":
      return (
        <>
          <GraphLodBadge tone={NEUTRAL}>
            {t(("projectGraph.pageKind." + data.pageKind) as MessageKey)}
          </GraphLodBadge>
          {data.routePaths.length === 0 ? (
            <GraphLodBadge tone={WARNING}>{t("projectGraph.pageUnrouted")}</GraphLodBadge>
          ) : (
            <GraphLodBadge tone={NEUTRAL}>
              {t("projectGraph.calls", { count: data.callCount })}
            </GraphLodBadge>
          )}
        </>
      );
    case "route":
      return (
        <>
          <GraphLodBadge tone={INFO}>{data.method}</GraphLodBadge>
          <GraphLodBadge tone={NEUTRAL}>
            {data.permission.length === 0 ? t("projectGraph.public") : data.permission.join(", ")}
          </GraphLodBadge>
          {data.elevations.length > 0 && (
            <GraphLodBadge tone={WARNING}>{t("projectGraph.elevated")}</GraphLodBadge>
          )}
          {data.wrapper !== "valid" && (
            <GraphLodBadge
              tone={data.wrapper === "invalid" ? "border-destructive/50 text-destructive" : WARNING}
            >
              {t(("projectGraph.wrapper." + data.wrapper) as MessageKey)}
            </GraphLodBadge>
          )}
        </>
      );
    case "table":
      return (
        <>
          {/* RLS is the default class (D-136): the badge names only the system-only exception. */}
          {!data.rlsEnabled && (
            <GraphLodBadge tone={NEUTRAL}>{t("projectGraph.systemOnly")}</GraphLodBadge>
          )}
          {data.unknown && (
            <GraphLodBadge tone={WARNING}>{t("projectGraph.unknown")}</GraphLodBadge>
          )}
          {data.framework && (
            <GraphLodBadge tone={NEUTRAL}>{t("projectGraph.framework")}</GraphLodBadge>
          )}
          <GraphLodBadge tone={NEUTRAL}>
            {t("projectGraph.columns", { count: data.columns.length })}
          </GraphLodBadge>
        </>
      );
    case "view":
      return (
        <>
          {data.access !== null && (
            <GraphLodBadge tone={data.access === "definer" ? WARNING : NEUTRAL}>
              {t(("projectGraph.access." + data.access) as MessageKey)}
            </GraphLodBadge>
          )}
          <GraphLodBadge
            tone={data.usedByRoutes.length > 0 ? "border-success/50 text-success" : NEUTRAL}
          >
            {data.usedByRoutes.length > 0
              ? t("projectGraph.viewUsedBy", { count: data.usedByRoutes.length })
              : t("projectGraph.viewUnused")}
          </GraphLodBadge>
          {data.unknown && (
            <GraphLodBadge tone={WARNING}>{t("projectGraph.unknown")}</GraphLodBadge>
          )}
        </>
      );
    case "workflow":
      return (
        <>
          <GraphLodBadge tone={NEUTRAL}>
            {t("projectGraph.workflow.steps", { count: data.steps.length })}
          </GraphLodBadge>
          {data.unknown && (
            <GraphLodBadge tone={WARNING}>{t("projectGraph.unknown")}</GraphLodBadge>
          )}
        </>
      );
  }
}
