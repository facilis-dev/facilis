// The state lenses' banner (D-224, #199): normalised facts rendered with the shared chrome, so
// a live lens looks like an analyzer lens without inventing a second panel.

import { t } from "@/i18n";
import type { GraphLensDefinition } from "@/facilis/graph-surface/lenses.ts";
import {
  factsByNode,
  legendEntryOf,
  type GraphLensState,
} from "@/facilis/graph-surface/state-facts.ts";
import {
  AnswerList,
  EmptyState,
  LensLegend,
  LensSection,
  type LensRow,
} from "./ProjectGraphLensBanner";

function totalLabel(state: GraphLensState): string | null {
  if (state.totals === null) return null;
  return t(state.totals.key, {
    count: state.totals.count,
    ...state.params,
    ...state.totals.params,
  });
}

export function ProjectGraphStateBanner({
  definition,
  state,
  nodeLabel,
  onClose,
  onActivate,
}: {
  definition: GraphLensDefinition;
  state: GraphLensState;
  nodeLabel: (id: string) => string | null;
  onClose: () => void;
  onActivate: (nodeId: string) => void;
}) {
  const rows: LensRow[] = [...factsByNode(state.facts).entries()].map(([nodeId, facts]) => ({
    nodeId,
    lines: facts.flatMap((fact) => {
      const legend = legendEntryOf(definition, fact.code);
      return legend === null
        ? []
        : [{ key: legend.messageKey, params: fact.params, colorToken: legend.colorToken }];
    }),
  }));
  return (
    <LensSection definition={definition} onClose={onClose}>
      <LensLegend
        definition={definition}
        total={totalLabel(state)}
        context={state.contextKey === null ? null : t(state.contextKey, state.params)}
      />
      {state.picker !== undefined && (
        <label className="flex items-center gap-1 px-2 pb-1 text-[10px] text-muted-foreground">
          {t(state.picker.labelKey)}
          <select
            data-testid="project-graph-lens-picker"
            value={state.picker.value}
            onChange={(event) => state.picker?.onSelect(event.target.value)}
            className="rounded border bg-panel px-1 py-0.5 text-[10px] text-foreground"
          >
            {state.picker.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title={t(state.emptyKey ?? "projectGraph.surface.state.emptyTitle", state.params)}
          hint={state.emptyHintKey === null ? null : t(state.emptyHintKey)}
          onClose={onClose}
        />
      ) : (
        <AnswerList rows={rows} nodeLabel={nodeLabel} onActivate={onActivate} />
      )}
    </LensSection>
  );
}
