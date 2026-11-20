// The lens chips (issue #63): the graph's reading controls docked bottom-left on the canvas,
// filling the HUD slot owned by #57. One chip per edge kind (the legend: colour + dash + count)
// and one per registered lens. Click isolates/activates, Shift-click adds to the isolation set,
// Alt-click hides an edge kind; a third lens is refused with a visible hint (epic rule 3).
// Roving tabindex: arrows move between chips, Space toggles, Alt+Space hides. Below md the row
// collapses into a "Lenses" button opening the same chips as an on-canvas popover — never a
// side panel (epic rule 1). State lives in the view state (#58), so it survives reload and URL.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Layers from "~icons/lucide/layers";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import { GRAPH_EDGE_KINDS } from "@/facilis/graph-types";
import { GRAPH_LENS_IDS, type GraphLensId } from "@/facilis/graph-view-state";
import { activateLens, isolateEdgeKind, lensRole } from "@/facilis/graph-lens-state";
import { Button } from "@/components/ui/button";
import { ProjectGraphChip, type ChipActivation } from "./ProjectGraphChip";

export interface ProjectGraphLensChipsProps {
  /** No analysis yet: the chips render disabled, like the rest of the HUD. */
  readonly disabled: boolean;
  readonly edgeCounts: Readonly<Record<GraphEdgeKind, number>>;
  readonly hiddenEdgeKinds: readonly GraphEdgeKind[];
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  readonly onIsolatedEdgeKindsChange: (kinds: readonly GraphEdgeKind[]) => void;
  readonly onHideEdgeKind: (kind: GraphEdgeKind, hidden: boolean) => void;
  readonly activeLenses: readonly GraphLensId[];
  readonly onActiveLensesChange: (lenses: readonly GraphLensId[]) => void;
}

/** The refusal hint stays visible long enough to read, then clears on its own. */
const HINT_TIMEOUT_MS = 4000;
const ARROW_KEYS = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"];

export function ProjectGraphLensChips(props: ProjectGraphLensChipsProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), HINT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  // Growing past the breakpoint brings the docked row back: the popover must not float over it.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (window.innerWidth >= 768) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // The popover closes on an outside pointer; Escape is handled on the wrapper so it also works
  // from the collapse button, and stops there so the panel's zen/focus Esc never fires too.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (wrapper.current !== null && !wrapper.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onEdgeActivation = (kind: GraphEdgeKind, { additive, hide }: ChipActivation) => {
    setHint(false);
    if (hide) {
      const hidden = props.hiddenEdgeKinds.includes(kind);
      props.onHideEdgeKind(kind, !hidden);
      // Hiding a kind also drops it from the isolation set: a hidden kind isolates nothing.
      if (!hidden && props.isolatedEdgeKinds.includes(kind)) {
        props.onIsolatedEdgeKindsChange(props.isolatedEdgeKinds.filter((entry) => entry !== kind));
      }
      return;
    }
    props.onIsolatedEdgeKindsChange(isolateEdgeKind(props.isolatedEdgeKinds, kind, additive));
  };
  const onLensActivation = (id: GraphLensId) => {
    const next = activateLens(props.activeLenses, id);
    if (next.refused) {
      setHint(true);
      return;
    }
    setHint(false);
    props.onActiveLensesChange(next.lenses);
  };

  const onWrapperKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    collapseButton.current?.focus();
  };
  const onToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.includes(event.key)) return;
    const chips = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-graph-chip]")];
    const current = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? chips.length - 1
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (current + 1) % chips.length
            : (current - 1 + chips.length) % chips.length;
    setFocusIndex(next);
    chips[next]?.focus();
  };

  const edgeChips = GRAPH_EDGE_KINDS.map((kind, index) => (
    <ProjectGraphChip
      key={"edge-" + kind}
      type="edge"
      kind={kind}
      isolated={props.isolatedEdgeKinds.includes(kind)}
      hidden={props.hiddenEdgeKinds.includes(kind)}
      count={props.edgeCounts[kind]}
      tabIndex={index === focusIndex ? 0 : -1}
      disabled={props.disabled}
      onFocus={() => setFocusIndex(index)}
      onActivate={(activation) => onEdgeActivation(kind, activation)}
    />
  ));
  const lensChips = GRAPH_LENS_IDS.map((id, offset) => {
    const index = GRAPH_EDGE_KINDS.length + offset;
    return (
      <ProjectGraphChip
        key={"lens-" + id}
        type="lens"
        id={id}
        role={lensRole(props.activeLenses, id)}
        tabIndex={index === focusIndex ? 0 : -1}
        disabled={props.disabled}
        onFocus={() => setFocusIndex(index)}
        onActivate={() => onLensActivation(id)}
      />
    );
  });

  return (
    <div
      ref={wrapper}
      data-testid="graph-lens-chips"
      className="relative flex items-center"
      onKeyDown={onWrapperKeyDown}
    >
      <Button
        ref={collapseButton}
        variant="ghost"
        size="xs"
        data-testid="graph-lens-collapse"
        className="md:hidden"
        aria-expanded={open}
        aria-label={t("projectGraph.lens.collapse")}
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Layers />
        <span>{t("projectGraph.lens.collapse")}</span>
      </Button>
      <div
        role="toolbar"
        aria-label={t("projectGraph.lens.label")}
        data-testid="graph-lens-toolbar"
        onKeyDown={onToolbarKeyDown}
        className={
          open
            ? "absolute bottom-full left-0 z-20 mb-1 flex flex-col items-stretch gap-0.5 rounded-lg border border-border bg-card/95 p-1 shadow-sm"
            : "hidden flex-wrap items-center gap-0.5 md:flex"
        }
      >
        {edgeChips}
        {lensChips}
        {hint ? (
          <span
            role="status"
            data-testid="graph-lens-hint"
            className="basis-full px-1.5 py-0.5 text-[10px] text-warning"
          >
            {t("projectGraph.lens.limitHint")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
