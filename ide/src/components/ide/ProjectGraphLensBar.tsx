// The in-place lens overlay (D-220, #189; state lenses #199): a persistent lens switcher plus,
// while a lens is active, its banner (title, description, legend, total), answer list and an
// explicit empty state. It overlays the canvas, so toggling a lens never resizes the surface or
// re-runs layout. The banner itself is one component for both fact families.

import { t } from "@/i18n";
import { useNarrowViewport } from "./use-narrow-viewport";
import { ProjectGraphLensBanner } from "./ProjectGraphLensBanner";
import { ProjectGraphStateBanner } from "./ProjectGraphStateBanner";
import {
  LENS_AVAILABLE,
  type GraphLensAvailability,
} from "@/facilis/graph-surface/lens-lifecycle.ts";
import { GRAPH_LENSES, lensDefinition } from "@/facilis/graph-surface/lenses-registry.ts";
import type { GraphLensId } from "@/facilis/graph-surface/lenses.ts";
import { lensQuestionKey } from "@/facilis/graph-surface/questions.ts";
import { LENS_PICKER_CHORD } from "./graph-lens-commands";
import type { GraphLensView } from "@/facilis/graph-surface/state-facts.ts";

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
        const hint = (reason ?? t(lensQuestionKey(definition.id))) + " (" + LENS_PICKER_CHORD + ")";
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

export function ProjectGraphLensBar({
  lens,
  view,
  nodeLabel,
  onSelectLens,
  onClose,
  onActivate,
  drawerOpen,
  availabilityOf = alwaysAvailable,
}: {
  lens: GraphLensId | null;
  view: GraphLensView | null;
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
      {definition !== null &&
        view !== null &&
        (view.kind === "diagnostics" ? (
          <ProjectGraphLensBanner
            definition={definition}
            summary={view.summary}
            nodeLabel={nodeLabel}
            onClose={onClose}
            onActivate={onActivate}
          />
        ) : (
          <ProjectGraphStateBanner
            definition={definition}
            state={view.state}
            nodeLabel={nodeLabel}
            onClose={onClose}
            onActivate={onActivate}
          />
        ))}
    </div>
  );
}
