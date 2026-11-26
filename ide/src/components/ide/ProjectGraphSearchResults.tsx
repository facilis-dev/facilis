// Search results for the graph jump (D-219, issue #187): a compact list under the toolbar
// input. Clicking a row (or pressing Enter in the input) drills to the node's domain, centres
// the camera and selects it. Presentational only; the panel owns the jump.

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
  query,
  results,
  onJump,
}: {
  query: string;
  results: readonly ProjectGraphNode[];
  onJump: (id: string) => void;
}) {
  if (query.trim().length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label={t("projectGraph.searchResults")}
      className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded border bg-panel p-1 shadow-lg"
    >
      {results.length === 0 ? (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">{t("projectGraph.noMatches")}</p>
      ) : (
        results.map((node) => (
          <button
            key={node.id}
            type="button"
            role="option"
            aria-selected={false}
            // Keep the input focused until the click lands: the result list hides on blur.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onJump(node.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-accent"
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
