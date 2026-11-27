// Search results for the graph jump (D-219, issue #187; listbox behaviour in issue #220): a
// compact disclosure list under the toolbar input. The toolbar owns the open state and the
// roving focus; this module renders the options and their selection state so a screen reader
// hears the active node instead of "not selected" on every row. Clicking a row (or pressing
// Enter on it) drills to the node's domain, centres the camera and selects it.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";

const KIND_KEYS: Record<GraphNodeKind, MessageKey> = {
  page: "projectGraph.node.page",
  route: "projectGraph.node.route",
  table: "projectGraph.node.table",
  view: "projectGraph.node.view",
  workflow: "projectGraph.node.workflow",
};

export function ProjectGraphSearchResults({
  id,
  query,
  results,
  activeIndex,
  onJump,
  onActiveChange,
}: {
  id: string;
  query: string;
  results: readonly ProjectGraphNode[];
  /** The option that owns the roving focus; -1 when the text input owns it. */
  activeIndex: number;
  onJump: (id: string) => void;
  onActiveChange: (index: number) => void;
}) {
  if (query.trim().length === 0) return null;
  // Results can shrink under a roving index while the debounce settles: never leave the list
  // without a tab stop.
  const selectedIndex = activeIndex >= 0 && activeIndex < results.length ? activeIndex : -1;
  return (
    <div
      id={id}
      role="listbox"
      aria-label={t("projectGraph.searchResults")}
      className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded border bg-panel p-1 shadow-lg"
    >
      {results.length === 0 ? (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">{t("projectGraph.noMatches")}</p>
      ) : (
        results.map((node, index) => (
          <button
            key={node.id}
            type="button"
            role="option"
            id={`${id}-option-${index}`}
            aria-selected={index === selectedIndex}
            // One tab stop for the whole list: Tab lands on the active (or first) option and the
            // arrows take over from there.
            tabIndex={index === selectedIndex || (selectedIndex === -1 && index === 0) ? 0 : -1}
            onFocus={() => onActiveChange(index)}
            onClick={() => onJump(node.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring aria-selected:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate">{node.label}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {t(KIND_KEYS[node.kind])}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
