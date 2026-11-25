// The in-place lens overlay (D-212, #189): a persistent lens switcher plus, while a lens is
// active, its banner (title, description, colour legend, total), the answer list and an explicit
// zero-match state. It overlays the canvas, so toggling a lens never resizes the surface or
// re-runs layout. Every string is a t() key; every colour is a semantic theme token.

import { t } from "@/i18n";
import { useNarrowViewport } from "./use-narrow-viewport";
import {
  DIAGNOSTIC_MESSAGE_KEYS,
  GRAPH_LENSES,
  diagnosticParams,
  lensDefinition,
  type GraphLensId,
  type GraphLensSummary,
} from "@/facilis/graph-surface/lenses.ts";

function LensSwitcher({
  lens,
  onSelectLens,
}: {
  lens: GraphLensId | null;
  onSelectLens: (lens: GraphLensId) => void;
}) {
  return (
    <div
      role="group"
      aria-label={t("projectGraph.surface.lens.title")}
      className="pointer-events-auto flex flex-wrap gap-1 rounded-lg border bg-panel/95 p-1 shadow"
    >
      {GRAPH_LENSES.map((definition) => {
        const active = definition.id === lens;
        return (
          <button
            key={definition.id}
            type="button"
            aria-pressed={active}
            data-testid={"project-graph-lens-" + definition.id}
            onClick={() => onSelectLens(definition.id)}
            className={
              "rounded px-2 py-1 text-[11px] " +
              (active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/10 hover:text-foreground")
            }
          >
            {t(definition.titleKey)}
          </button>
        );
      })}
    </div>
  );
}

function AnswerRows({
  summary,
  nodeLabel,
  onActivate,
}: {
  summary: GraphLensSummary;
  nodeLabel: (id: string) => string | null;
  onActivate: (nodeId: string) => void;
}) {
  return (
    <ul className="max-h-52 overflow-auto border-t">
      {[...summary.byNode.entries()].map(([nodeId, entries]) => (
        <li key={nodeId} className="border-b last:border-b-0">
          <button
            type="button"
            data-testid={"project-graph-lens-answer-" + nodeId}
            onClick={() => onActivate(nodeId)}
            className="block w-full px-2 py-1.5 text-left hover:bg-accent/10"
          >
            <span className="block truncate text-[11px] font-medium text-foreground">
              {nodeLabel(nodeId) ?? nodeId}
            </span>
            {entries.map((entry, index) => (
              <span
                key={entry.code + ":" + index}
                className="mt-0.5 block text-[10px] leading-snug text-muted-foreground"
              >
                {t(DIAGNOSTIC_MESSAGE_KEYS[entry.code], diagnosticParams(entry))}
              </span>
            ))}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProjectGraphLensBar({
  lens,
  summary,
  nodeLabel,
  onSelectLens,
  onClose,
  onActivate,
  drawerOpen,
}: {
  lens: GraphLensId | null;
  summary: GraphLensSummary | null;
  nodeLabel: (id: string) => string | null;
  onSelectLens: (lens: GraphLensId) => void;
  onClose: () => void;
  onActivate: (nodeId: string) => void;
  /** The mobile bottom sheet reserves the lower 60%: keep the lens HUD above it (#191). */
  drawerOpen: boolean;
}) {
  const sheetOpen = useNarrowViewport() && drawerOpen;
  const definition = lens === null ? null : lensDefinition(lens);
  return (
    <div
      data-testid="project-graph-lens-bar"
      className={
        "pointer-events-none absolute left-2 top-12 z-10 flex w-72 max-w-[calc(100%-1rem)] flex-col items-start gap-1 " +
        (sheetOpen ? "max-h-[calc(40%-4rem)] overflow-y-auto" : "max-h-[calc(100%-4rem)]")
      }
    >
      <LensSwitcher lens={lens} onSelectLens={onSelectLens} />
      {definition !== null && summary !== null && (
        <section
          data-testid="project-graph-lens-banner"
          aria-label={t(definition.titleKey)}
          className="pointer-events-auto w-full overflow-hidden rounded-lg border bg-panel/95 text-xs shadow-xl"
        >
          <header className="flex items-start gap-2 border-b px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[11px] font-semibold text-foreground">
                {t(definition.titleKey)}
              </h3>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {t(definition.descriptionKey)}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("projectGraph.surface.lens.close")}
              data-testid="project-graph-lens-close"
              onClick={onClose}
              className="rounded px-1 text-muted-foreground hover:bg-accent/10 hover:text-foreground"
            >
              ×
            </button>
          </header>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
              {t("projectGraph.surface.lens.legend")}
            </span>
            {definition.legend.map((entry) => (
              <span key={entry.code} className="flex items-center gap-1 text-[10px]">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: "var(" + entry.colorToken + ")" }}
                />
                <span className="text-muted-foreground">{t(entry.labelKey)}</span>
              </span>
            ))}
            <span
              data-testid="project-graph-lens-count"
              className="ml-auto rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
            >
              {t("projectGraph.surface.lens.count", { count: summary.count })}
            </span>
          </div>
          {summary.count === 0 ? (
            <div
              data-testid="project-graph-lens-empty"
              className="border-t px-2 py-2"
              role="status"
            >
              <p className="text-[11px] font-medium text-foreground">
                {t("projectGraph.surface.lens.emptyTitle")}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {t("projectGraph.surface.lens.emptyHint", { lens: t(definition.titleKey) })}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-1 rounded border px-2 py-0.5 text-[10px] text-foreground hover:bg-accent/10"
              >
                {t("projectGraph.surface.lens.emptyLeave")}
              </button>
            </div>
          ) : (
            <AnswerRows summary={summary} nodeLabel={nodeLabel} onActivate={onActivate} />
          )}
        </section>
      )}
    </div>
  );
}
