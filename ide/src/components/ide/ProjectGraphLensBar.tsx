// The in-place lens overlay (D-220, #189): a persistent lens switcher plus, while a lens is
// active, its banner (title, description, colour legend, total), the answer list and an explicit
// zero-match state. It overlays the canvas, so toggling a lens never resizes the surface or
// re-runs layout. Every string is a t() key; every colour is a semantic theme token.

import { t } from "@/i18n";
import { useNarrowViewport } from "./use-narrow-viewport";
import {
  LENS_AVAILABLE,
  type GraphLensAvailability,
} from "@/facilis/graph-surface/lens-lifecycle.ts";
import {
  DIAGNOSTIC_MESSAGE_KEYS,
  GRAPH_LENSES,
  diagnosticParams,
  lensDefinition,
  type GraphLensId,
  type GraphLensSummary,
} from "@/facilis/graph-surface/lenses.ts";
import { lensQuestionKey } from "@/facilis/graph-surface/questions.ts";

const alwaysAvailable = (): GraphLensAvailability => LENS_AVAILABLE;

function lensButtonClass(active: boolean, unavailable: boolean): string {
  if (unavailable) return "shrink-0 rounded px-2 py-1 text-[11px] text-muted-foreground/60";
  const state = active
    ? "bg-accent text-accent-foreground"
    : "text-muted-foreground hover:bg-accent/10 hover:text-foreground";
  return "shrink-0 rounded px-2 py-1 text-[11px] " + state;
}

function LensSwitcher({
  lens,
  onSelectLens,
  availabilityOf,
}: {
  lens: GraphLensId | null;
  onSelectLens: (lens: GraphLensId) => void;
  availabilityOf: (lens: GraphLensId) => GraphLensAvailability;
}) {
  return (
    <div
      role="group"
      aria-label={t("projectGraph.surface.lens.title")}
      className="pointer-events-auto flex flex-nowrap items-center gap-1 overflow-x-auto rounded-lg border bg-panel/95 p-1 shadow"
    >
      <span
        className="shrink-0 px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
        title={t("projectGraph.surface.question.hint")}
      >
        {t("projectGraph.surface.lens.title")}
      </span>
      {GRAPH_LENSES.map((definition) => {
        const active = definition.id === lens;
        // A Q-code alone means nothing: the hover text is the review question the lens answers.
        const title = t(definition.titleKey);
        const availability = availabilityOf(definition.id);
        const reasonKey = availability.available ? null : availability.reasonKey;
        // An unavailable lens says why, in the same translated words the banner would use.
        const reason = reasonKey === null ? null : t(reasonKey);
        const unavailable = reason !== null;
        const hint = reason ?? t(lensQuestionKey(definition.id));
        return (
          <button
            key={definition.id}
            type="button"
            aria-pressed={active}
            aria-label={title + " — " + hint}
            title={hint}
            disabled={unavailable}
            data-testid={"project-graph-lens-" + definition.id}
            data-unavailable={unavailable ? "true" : undefined}
            onClick={() => onSelectLens(definition.id)}
            className={lensButtonClass(active, unavailable)}
          >
            <span className="hidden @sm:inline">{t(definition.titleKey)}</span>
            <span className="@sm:hidden">{t(definition.shortKey)}</span>
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
    <ul
      aria-label={t("projectGraph.surface.lens.answers")}
      className="max-h-52 overflow-auto border-t"
    >
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
  availabilityOf = alwaysAvailable,
}: {
  lens: GraphLensId | null;
  summary: GraphLensSummary | null;
  nodeLabel: (id: string) => string | null;
  onSelectLens: (lens: GraphLensId) => void;
  onClose: () => void;
  onActivate: (nodeId: string) => void;
  /** The mobile bottom sheet reserves the lower 60%: keep the lens HUD above it (#191). */
  drawerOpen: boolean;
  availabilityOf?: (lens: GraphLensId) => GraphLensAvailability;
}) {
  const sheetOpen = useNarrowViewport() && drawerOpen;
  const definition = lens === null ? null : lensDefinition(lens);
  return (
    <div
      data-testid="project-graph-lens-bar"
      className={
        "@container pointer-events-none absolute left-2 top-12 z-10 flex w-[calc(100%-1rem)] max-w-md flex-col items-start gap-1 " +
        (sheetOpen ? "max-h-[calc(40%-4rem)] overflow-y-auto" : "max-h-[calc(100%-4rem)]")
      }
    >
      <LensSwitcher lens={lens} onSelectLens={onSelectLens} availabilityOf={availabilityOf} />
      {definition !== null && summary !== null && (
        <section
          data-testid="project-graph-lens-banner"
          aria-label={t(definition.titleKey)}
          style={{ borderTopColor: "var(" + definition.colorToken + ")", borderTopWidth: 2 }}
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
