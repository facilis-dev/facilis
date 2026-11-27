// The visible commit list (issue #226): the keyboard path into the commit graph. React
// Flow's node wrappers are focusable but Enter/Space there is dropped — the graph is
// controlled without onNodesChange — so the list, not the canvas, is the tab stop: one
// roving tabindex, arrows move the active row, Enter selects it (which opens the inspector)
// and Escape clears. The panel's selectedId drives both the list highlight and the canvas
// ring, so the two cannot disagree.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import GitBranch from "~icons/lucide/git-branch";
import { t } from "@/i18n";
import type { CommitGraph } from "@/facilis/commit-graph-model";
import {
  activeCommitRow,
  buildCommitListRows,
  commitListIntent,
  commitListOptionAttributes,
} from "@/facilis/commit-graph-list-model";

export function CommitGraphList({
  graph,
  selectedId,
  onSelect,
}: {
  graph: CommitGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const hintId = useId();
  const rows = useMemo(() => buildCommitListRows(graph), [graph]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const options = useRef(new Map<string, HTMLDivElement>());
  const active = activeCommitRow(rows, activeId ?? selectedId);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;

  // A click on the canvas selects a commit without touching the list: move the roving tab
  // stop onto it so Tab back into the list lands where the canvas ring already is.
  useEffect(() => {
    if (selectedId === null) return;
    setActiveId((current) => (current === selectedId ? current : selectedId));
  }, [selectedId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const intent = commitListIntent(rows, active?.id ?? null, event);
    if (intent === null) return;
    event.preventDefault();
    if (intent.kind === "clear") {
      onSelect(null);
      return;
    }
    if (intent.kind === "select") {
      onSelect(intent.id);
      return;
    }
    setActiveId(intent.id);
    options.current.get(intent.id)?.focus();
  };

  return (
    <div
      data-testid="commit-graph-list"
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar"
    >
      <p className="shrink-0 border-b px-2 py-1.5 text-[11px] font-semibold">
        {t("commitGraph.list.label")}
      </p>
      <div
        role="listbox"
        aria-label={t("commitGraph.list.label")}
        aria-describedby={hintId}
        data-testid="commit-graph-listbox"
        className="min-h-0 flex-1 overflow-y-auto p-1"
        onKeyDown={onKeyDown}
      >
        {rows.map((row) => {
          const isActive = active?.id === row.id;
          const isSelected = row.id === selectedId;
          return (
            <div
              key={row.id}
              ref={(element) => {
                if (element === null) options.current.delete(row.id);
                else options.current.set(row.id, element);
              }}
              {...commitListOptionAttributes(isActive, isSelected)}
              data-testid="commit-graph-list-option"
              aria-label={t("commitGraph.list.option", { message: row.summary, short: row.short })}
              onClick={() => {
                setActiveId(row.id);
                onSelect(row.id);
              }}
              className={
                "flex cursor-pointer flex-col rounded px-2 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 " +
                (isSelected
                  ? "border border-primary bg-primary/10"
                  : "border border-transparent " +
                    (isActive ? "bg-accent/10" : "hover:bg-accent/10"))
              }
            >
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {row.summary}
                </span>
                {row.head && (
                  <span className="shrink-0 rounded border border-brand/50 bg-brand/10 px-1 text-[9px] font-semibold text-brand">
                    {t("commitGraph.head")}
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="shrink-0 font-mono">{row.short}</span>
                <span className="min-w-0 truncate">{row.author}</span>
                {row.branches.length > 0 && (
                  <span className="ml-auto flex min-w-0 shrink items-center gap-0.5">
                    <GitBranch className="size-2.5 shrink-0" />
                    <span className="truncate">{row.branches[0]}</span>
                    {row.branches.length > 1 && <span>+{row.branches.length - 1}</span>}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p id={hintId} className="shrink-0 border-t px-2 py-1 text-[10px] text-muted-foreground">
        {t("commitGraph.list.hint")}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {selectedRow === null
          ? ""
          : t("commitGraph.list.selected", {
              message: selectedRow.summary,
              short: selectedRow.short,
            })}
      </p>
    </div>
  );
}
