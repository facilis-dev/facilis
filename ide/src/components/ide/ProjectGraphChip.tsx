// One lens/edge-kind chip (issue #63): a keyboard-reachable toggle button that carries the
// legend (colour + dash for edges), the label, the count and the state. Plain click isolates or
// activates, Shift adds to the isolation set, Alt hides (edge kinds only); the toolbar owns the
// roving tabindex, the chip only reports focus. Role tokens only (D-044), every string via t()
// (D-043); no text below 7px (epic rule 4).

import type { KeyboardEvent, MouseEvent } from "react";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { GraphLensId } from "@/facilis/graph-view-state";
import { GRAPH_EDGE_LABEL_KEYS, GRAPH_EDGE_STYLES } from "./project-graph-edges";

export const LENS_LABEL_KEYS: Record<GraphLensId, MessageKey> = {
  contract: "projectGraph.lens.contract",
  data: "projectGraph.lens.data",
  runtime: "projectGraph.lens.runtime",
  agent: "projectGraph.lens.agent",
  impact: "projectGraph.lens.impact",
  roles: "projectGraph.lens.roles",
};

// Identity dots name the semantic status roles (D-044). The lens marks themselves arrive in
// later issues; the dot only previews which layer the chip drives, at 30% when secondary.
const LENS_DOT_COLORS: Record<GraphLensId, string> = {
  contract: "var(--brand)",
  data: "var(--info)",
  runtime: "var(--success)",
  agent: "var(--warning)",
  impact: "var(--destructive)",
  roles: "var(--muted-foreground)",
};

export interface ChipActivation {
  /** Shift was held: add to (or remove from) the isolation set instead of replacing it. */
  readonly additive: boolean;
  /** Alt was held on an edge chip: hide the kind instead of isolating it. */
  readonly hide: boolean;
}

export type ProjectGraphChipProps = {
  readonly tabIndex: number;
  readonly disabled: boolean;
  readonly onFocus: () => void;
  readonly onActivate: (activation: ChipActivation) => void;
} & (
  | {
      readonly type: "edge";
      readonly kind: GraphEdgeKind;
      readonly isolated: boolean;
      readonly hidden: boolean;
      readonly count: number;
    }
  | {
      readonly type: "lens";
      readonly id: GraphLensId;
      readonly role: "dominant" | "secondary" | null;
    }
);

const BASE =
  "inline-flex shrink-0 items-center gap-1 rounded border border-transparent px-1.5 py-0.5 " +
  "text-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-default disabled:opacity-50 ";
const ACTIVE = "border-ring bg-accent text-accent-foreground ";
const IDLE = "text-muted-foreground hover:bg-accent hover:text-foreground ";

export function ProjectGraphChip(props: ProjectGraphChipProps) {
  const isEdge = props.type === "edge";
  const label = isEdge ? t(GRAPH_EDGE_LABEL_KEYS[props.kind]) : t(LENS_LABEL_KEYS[props.id]);
  const pressed = isEdge ? props.isolated : props.role !== null;
  const state = isEdge
    ? props.isolated
      ? ACTIVE
      : props.hidden
        ? IDLE + "opacity-60 "
        : IDLE
    : props.role === "dominant"
      ? ACTIVE
      : props.role === "secondary"
        ? ACTIVE
        : IDLE;

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    props.onActivate(
      isEdge ? { additive: event.shiftKey, hide: event.altKey } : { additive: false, hide: false },
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " ") return;
    // Alt+Space hides; Shift+Space adds to the set. Plain Space falls through to the native
    // button click, so the keyboard and the pointer share one activation path.
    if (event.altKey) {
      if (!isEdge) return;
      event.preventDefault();
      props.onActivate({ additive: false, hide: true });
      return;
    }
    if (event.shiftKey && isEdge) {
      event.preventDefault();
      props.onActivate({ additive: true, hide: false });
    }
  };

  return (
    <button
      type="button"
      data-graph-chip
      data-testid={isEdge ? "graph-chip-edge-" + props.kind : "graph-chip-lens-" + props.id}
      tabIndex={props.tabIndex}
      disabled={props.disabled}
      aria-pressed={pressed}
      title={t(isEdge ? "projectGraph.chip.edgeHint" : "projectGraph.chip.lensHint", { label })}
      className={BASE + state}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={props.onFocus}
    >
      {isEdge ? (
        <svg width="14" height="6" viewBox="0 0 14 6" aria-hidden="true" className="shrink-0">
          <line
            x1="1"
            y1="3"
            x2="13"
            y2="3"
            stroke={GRAPH_EDGE_STYLES[props.kind].stroke}
            strokeWidth="2"
            strokeDasharray={GRAPH_EDGE_STYLES[props.kind].dashed ? "3 2" : undefined}
          />
        </svg>
      ) : (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{
            background: LENS_DOT_COLORS[props.id],
            opacity: props.role === "secondary" ? 0.3 : 1,
          }}
        />
      )}
      <span>{label}</span>
      {isEdge ? (
        <span className="tabular-nums">{props.count}</span>
      ) : props.role === "secondary" ? (
        <span className="rounded border border-border px-0.5 text-[9px]">
          {t("projectGraph.lens.secondary")}
        </span>
      ) : null}
      {isEdge && props.hidden ? (
        <span className="rounded border border-border px-0.5 text-[9px]">
          {t("projectGraph.chip.hidden")}
        </span>
      ) : null}
    </button>
  );
}
