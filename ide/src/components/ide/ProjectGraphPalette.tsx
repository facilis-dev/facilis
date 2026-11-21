// The graph command palette (issue #68): a floating dialog opened by Cmd/Ctrl+K — never a
// side panel (epic #56 rule 1). Fuzzy search over the node facts plus every graph command,
// grouped by kind with the node's badge; Enter zooms to the node and selects it (the same
// view-state selection a canvas click sets). The ranking is pure (graph-palette.ts); this
// file only owns the dialog semantics: autofocused search, ArrowUp/Down + Enter + Esc, and
// role="dialog"/listbox/option with an accessible name on every option. Esc is handled here
// and prevented, so the document-level graph hook never double-fires; the search input is a
// typing target, so the plain-key guard already protects it. Role tokens only (D-044).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "@/i18n";
import {
  flattenPaletteGroups,
  rankPalette,
  type PaletteCommandId,
  type PaletteEntry,
  type PaletteIndex,
} from "@/facilis/graph-palette";
import { GRAPH_NODE_KIND_ICONS, GRAPH_NODE_KIND_LABEL_KEYS } from "./project-graph-kind-tokens";
import { paletteCommandLabel } from "./project-graph-edges";

export interface ProjectGraphPaletteProps {
  readonly open: boolean;
  readonly index: PaletteIndex;
  readonly onClose: () => void;
  readonly onZoomToNode: (id: string) => void;
  readonly onRunCommand: (id: PaletteCommandId) => void;
}

function entryKey(entry: PaletteEntry): string {
  return entry.type === "node" ? entry.id : entry.command.id;
}

export function ProjectGraphPalette({
  open,
  index,
  onClose,
  onZoomToNode,
  onRunCommand,
}: ProjectGraphPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const groups = useMemo(() => rankPalette(index, query), [index, query]);
  const flat = useMemo(() => flattenPaletteGroups(groups), [groups]);
  const listRef = useRef<HTMLDivElement | null>(null);

  // A fresh open starts on the whole graph with the first option highlighted.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, flat]);

  if (!open) return null;

  const activate = (entry: PaletteEntry) => {
    if (entry.type === "node") onZoomToNode(entry.id);
    else onRunCommand(entry.command.id);
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (flat.length === 0 ? 0 : (current + 1) % flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = flat[active];
      if (entry !== undefined) activate(entry);
    }
  };

  let optionIndex = -1;
  return (
    <div className="absolute inset-0 z-30" data-testid="graph-palette">
      <div aria-hidden className="absolute inset-0 bg-overlay/70" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("projectGraph.palette.label")}
        onKeyDown={onKeyDown}
        className="absolute inset-x-0 top-[12%] mx-auto flex w-[min(32rem,calc(100%-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          placeholder={t("projectGraph.palette.placeholder")}
          aria-label={t("projectGraph.palette.placeholder")}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="graph-palette-listbox"
          aria-activedescendant={
            flat.length > 0
              ? "graph-palette-option-" + Math.min(active, flat.length - 1)
              : undefined
          }
          data-testid="graph-palette-input"
          className="h-9 w-full border-b border-border bg-transparent px-3 text-xs outline-none placeholder:text-muted-foreground"
        />
        <div
          ref={listRef}
          id="graph-palette-listbox"
          role="listbox"
          aria-label={t("projectGraph.palette.label")}
          data-testid="graph-palette-listbox"
          className="max-h-80 overflow-y-auto p-1"
        >
          {flat.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              {t("projectGraph.palette.empty")}
            </p>
          )}
          {groups.map((group) => (
            <div
              key={group.kind}
              role="group"
              aria-label={
                group.kind === "command"
                  ? t("projectGraph.palette.commands")
                  : t(GRAPH_NODE_KIND_LABEL_KEYS[group.kind])
              }
              data-testid={"graph-palette-group-" + group.kind}
            >
              <p className="px-2 pt-2 pb-1 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
                {group.kind === "command"
                  ? t("projectGraph.palette.commands")
                  : t(GRAPH_NODE_KIND_LABEL_KEYS[group.kind])}
              </p>
              {group.entries.map((entry) => {
                optionIndex += 1;
                const position = optionIndex;
                const selected = position === active;
                const label =
                  entry.type === "node"
                    ? t("projectGraph.palette.nodeOption", {
                        label: entry.label,
                        kind: t(GRAPH_NODE_KIND_LABEL_KEYS[entry.kind]),
                      })
                    : paletteCommandLabel(entry.command);
                const Icon = entry.type === "node" ? GRAPH_NODE_KIND_ICONS[entry.kind] : null;
                return (
                  <div
                    key={entryKey(entry)}
                    id={"graph-palette-option-" + position}
                    role="option"
                    aria-selected={selected}
                    aria-label={label}
                    data-testid={"graph-palette-option-" + position}
                    data-kind={entry.type === "node" ? entry.kind : "command"}
                    onClick={() => activate(entry)}
                    onMouseEnter={() => setActive(position)}
                    className={
                      "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs " +
                      (selected ? "bg-accent text-accent-foreground" : "")
                    }
                  >
                    {Icon !== null && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">
                      {entry.type === "node" ? entry.label : paletteCommandLabel(entry.command)}
                    </span>
                    <span className="shrink-0 truncate font-mono text-[9px] text-muted-foreground">
                      {entry.type === "node" ? entry.detail : (entry.command.shortcut ?? "")}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="border-t border-border px-3 py-1.5 text-[9px] text-muted-foreground">
          {t("projectGraph.palette.nodeHint")}
        </p>
      </div>
    </div>
  );
}
