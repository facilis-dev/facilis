// The data lens's ribbon (issue #70): a floating summary docked in the bottom-left HUD cluster
// beside the stats ribbon and the lens chips — never a side panel (epic rule 1). Three counters
// scan the same visible view the canvas draws (criterion 4), and the legend names every stroke
// the lens encodes so the dash patterns are self-explanatory. The counters are a read-only
// summary, not filters: the lens adds NO new view state (epic rule 6) — activation and selection
// already round-trip through the gv URL. Glyph + count + label on every counter, so no state is
// colour-only (epic rule 6).

import CircleSlash from "~icons/lucide/circle-slash";
import Lock from "~icons/lucide/lock";
import UserCog from "~icons/lucide/user-cog";
import { t, type MessageKey } from "@/i18n";
import type { DataCounts } from "@/facilis/graph-data-lens";
import {
  DATA_EDGE_STYLES,
  DATA_ELEVATED_STYLE,
  GRAPH_EDGE_LABEL_KEYS,
  type DataEdgeStyle,
} from "./project-graph-edges";

const COUNTERS: readonly {
  readonly id: keyof DataCounts;
  readonly testId: string;
  readonly glyph: typeof Lock;
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
}[] = [
  {
    id: "unscopedTables",
    testId: "graph-data-unscoped",
    glyph: CircleSlash,
    labelKey: "projectGraph.data.unscoped",
    hintKey: "projectGraph.data.unscopedHint",
  },
  {
    id: "definerViews",
    testId: "graph-data-definer",
    glyph: UserCog,
    labelKey: "projectGraph.data.definer",
    hintKey: "projectGraph.data.definerHint",
  },
  {
    id: "elevatedEdges",
    testId: "graph-data-elevated",
    glyph: Lock,
    labelKey: "projectGraph.data.elevated",
    hintKey: "projectGraph.data.elevatedHint",
  },
];

/** The five strokes the lens encodes, in legend order; each names its own dash pattern. */
const LEGEND: readonly {
  readonly id: string;
  readonly style: DataEdgeStyle;
  readonly labelKey: MessageKey;
  readonly patternKey: MessageKey;
}[] = [
  {
    id: "fk",
    style: DATA_EDGE_STYLES.fk,
    labelKey: GRAPH_EDGE_LABEL_KEYS.fk,
    patternKey: "projectGraph.data.pattern.solid",
  },
  {
    id: "relation",
    style: DATA_EDGE_STYLES.relation,
    labelKey: GRAPH_EDGE_LABEL_KEYS.relation,
    patternKey: "projectGraph.data.pattern.dashed",
  },
  {
    id: "view-base",
    style: DATA_EDGE_STYLES["view-base"],
    labelKey: GRAPH_EDGE_LABEL_KEYS["view-base"],
    patternKey: "projectGraph.data.pattern.shortDash",
  },
  {
    id: "route-view",
    style: DATA_EDGE_STYLES["route-view"],
    labelKey: GRAPH_EDGE_LABEL_KEYS["route-view"],
    patternKey: "projectGraph.data.pattern.dashDot",
  },
  {
    id: "elevated",
    style: DATA_ELEVATED_STYLE,
    labelKey: "projectGraph.data.elevated",
    patternKey: "projectGraph.data.pattern.dottedLock",
  },
];

export interface ProjectGraphDataRibbonProps {
  readonly counts: DataCounts;
  /** No analysis yet: the counters render muted, like the rest of the HUD. */
  readonly disabled: boolean;
}

export function ProjectGraphDataRibbon({ counts, disabled }: ProjectGraphDataRibbonProps) {
  return (
    <div
      role="group"
      aria-label={t("projectGraph.data.label")}
      data-testid="graph-data-ribbon"
      className={"flex flex-wrap items-center gap-x-2 gap-y-0.5" + (disabled ? " opacity-50" : "")}
    >
      <div className="flex flex-wrap items-center gap-1">
        {COUNTERS.map(({ id, testId, glyph: Icon, labelKey, hintKey }) => (
          <span
            key={id}
            data-testid={testId}
            title={t(hintKey)}
            className="inline-flex items-center gap-0.5 rounded border border-border px-1 text-[10px] text-muted-foreground"
          >
            <Icon className="size-3" />
            <span className="tabular-nums text-foreground">{counts[id]}</span>
            <span className="hidden xl:inline">{t(labelKey)}</span>
          </span>
        ))}
      </div>
      {/* The stroke legend: a sample of each dash pattern plus its name, so the encoding reads
          without hovering (epic rule 6). The lock entry names the elevated edge's glyph. */}
      <div
        role="group"
        aria-label={t("projectGraph.data.legend")}
        data-testid="graph-data-legend"
        className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
      >
        {LEGEND.map(({ id, style, labelKey, patternKey }) => (
          <span
            key={id}
            data-testid={"graph-data-legend-" + id}
            className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground"
          >
            <svg width="14" height="6" viewBox="0 0 14 6" aria-hidden="true" className="shrink-0">
              <line
                x1="1"
                y1="3"
                x2="13"
                y2="3"
                stroke={style.stroke}
                strokeWidth="2"
                strokeDasharray={style.dash ?? undefined}
              />
            </svg>
            {t("projectGraph.data.legendEntry", {
              stroke: t(labelKey),
              pattern: t(patternKey),
            })}
          </span>
        ))}
      </div>
    </div>
  );
}
