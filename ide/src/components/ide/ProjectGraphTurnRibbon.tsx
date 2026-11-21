// The agent lens's HUD segment (issue #73): the turn-diff counters, the base ref and the
// "not on the graph" list, docked in the bottom-left ribbon beside the lens chips. Floating
// HUD only (epic rule 1): the unmapped list opens as an on-canvas popover above the button,
// never a side panel. A secondary lens fades the whole segment to ~30% (epic rule 3); a clean
// tree shows an explicit clean state instead of silently disappearing (rule 5: visible states).

import { useEffect, useRef, useState } from "react";
import GitCompare from "~icons/lucide/git-compare";
import { t } from "@/i18n";
import type { GraphTurnDiff } from "@/facilis/graph-turn-diff";

/** M/A/D are git status symbols (like the route method badges); the title carries the meaning. */
function Counter({
  letter,
  count,
  label,
  tone,
}: {
  letter: string;
  count: number;
  label: string;
  tone: string;
}) {
  const text = t("projectGraph.turnDiff.counter", { count, label });
  return (
    <span
      title={text}
      aria-label={text}
      className={"flex shrink-0 items-center gap-0.5 text-[9px] " + tone}
    >
      <span className="rounded border border-current px-0.5 font-mono font-bold">{letter}</span>
      <span className="tabular-nums">{count}</span>
      <span className="hidden xl:inline">{label}</span>
    </span>
  );
}

export function ProjectGraphTurnRibbon({
  diff,
  secondary,
  ready,
}: {
  diff: GraphTurnDiff;
  secondary: boolean;
  /** False without a git repo or an analysis: an explicit state, never a silent guess. */
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  // The popover closes on an outside pointer, like the lens chips' popover does.
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

  return (
    <div
      ref={wrapper}
      data-testid="graph-turn-ribbon"
      aria-label={t("projectGraph.turnDiff.label")}
      className={
        "relative flex items-center gap-1 border-l border-border pl-1 " +
        (secondary ? "opacity-30" : "")
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <GitCompare className="size-3.5 shrink-0 text-muted-foreground" />
      {!ready ? (
        <span data-testid="graph-turn-nogit" className="text-[9px] text-muted-foreground">
          {t("projectGraph.turnDiff.noGit")}
        </span>
      ) : diff.active ? (
        <>
          <Counter
            letter="M"
            count={diff.counts.changed}
            label={t("projectGraph.turnDiff.changed")}
            tone="text-warning"
          />
          <Counter
            letter="A"
            count={diff.counts.added}
            label={t("projectGraph.turnDiff.added")}
            tone="text-success"
          />
          <Counter
            letter="D"
            count={diff.counts.deleted}
            label={t("projectGraph.turnDiff.deleted")}
            tone="text-destructive"
          />
          <span
            data-testid="graph-turn-base"
            className="shrink-0 text-[9px] text-muted-foreground"
            title={t("projectGraph.turnDiff.baseHint")}
          >
            {t("projectGraph.turnDiff.base", { ref: diff.baseRef })}
          </span>
          {diff.unmapped.length > 0 && (
            <div className="relative">
              <button
                type="button"
                data-testid="graph-turn-unmapped"
                aria-expanded={open}
                title={t("projectGraph.turnDiff.unmappedHint")}
                className="rounded border border-border px-1 text-[9px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setOpen((value) => !value)}
              >
                {t("projectGraph.turnDiff.unmapped", { count: diff.unmapped.length })}
              </button>
              {open && (
                <ul
                  data-testid="graph-turn-unmapped-list"
                  className="absolute bottom-full left-0 z-20 mb-1 max-h-40 w-64 overflow-auto rounded-lg border border-border bg-card/95 p-1 shadow-sm"
                >
                  {diff.unmapped.map((path) => (
                    <li
                      key={path}
                      title={path}
                      className="truncate px-1 py-0.5 font-mono text-[9px] text-muted-foreground"
                    >
                      {path}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <span data-testid="graph-turn-clean" className="text-[9px] text-muted-foreground">
          {t("projectGraph.turnDiff.clean")}
        </span>
      )}
    </div>
  );
}
