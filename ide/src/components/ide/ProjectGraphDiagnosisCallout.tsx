// The selected node's callout (D-220, #189; state lenses D-224, #199): analyzer diagnostics and
// state facts for that node, resolved through t(code, params) so an en/it switch re-translates in
// place without a reload. It sits inside the existing drawer, so selecting a flagged answer
// reuses the #187 path.

import type { GraphDiagnostic } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import {
  DIAGNOSTIC_COLOR_TOKENS,
  DIAGNOSTIC_LABEL_KEYS,
  DIAGNOSTIC_MESSAGE_KEYS,
  diagnosticParams,
  type GraphLensId,
} from "@/facilis/graph-surface/lenses.ts";
import { lensDefinition } from "@/facilis/graph-surface/lenses-registry.ts";
import { legendEntryOf, type GraphLensView } from "@/facilis/graph-surface/state-facts.ts";

export function ProjectGraphDiagnosisCallout({
  diagnostics,
  lens = null,
  view = null,
  selectedNodeId = null,
}: {
  diagnostics: readonly GraphDiagnostic[];
  lens?: GraphLensId | null;
  view?: GraphLensView | null;
  selectedNodeId?: string | null;
}) {
  const definition = lens === null ? null : lensDefinition(lens);
  const state = view?.kind === "state" ? view.state : null;
  const facts =
    state === null || selectedNodeId === null
      ? []
      : state.facts.filter((fact) => fact.nodeId === selectedNodeId);
  if (diagnostics.length === 0 && facts.length === 0) return null;
  return (
    <>
      {diagnostics.length > 0 && (
        <section
          data-testid="project-graph-diagnosis-callout"
          aria-label={t("projectGraph.surface.diag.title")}
          className="shrink-0 border-b bg-panel px-3 py-2"
        >
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("projectGraph.surface.diag.title")}
          </h3>
          <ul className="mt-1 space-y-1.5">
            {diagnostics.map((entry, index) => (
              <li
                key={entry.code + ":" + index}
                className="flex gap-2 border-l-2 pl-2"
                style={{ borderColor: "var(" + DIAGNOSTIC_COLOR_TOKENS[entry.code] + ")" }}
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-foreground">
                    {t(DIAGNOSTIC_LABEL_KEYS[entry.code])}
                  </p>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    {t(DIAGNOSTIC_MESSAGE_KEYS[entry.code], diagnosticParams(entry))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {facts.length > 0 && definition !== null && (
        <section
          data-testid="project-graph-state-callout"
          aria-label={t("projectGraph.surface.state.title")}
          className="shrink-0 border-b bg-panel px-3 py-2"
        >
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("projectGraph.surface.state.title")}
          </h3>
          <ul className="mt-1 space-y-1.5">
            {facts.map((fact, index) => {
              const legend = legendEntryOf(definition, fact.code);
              if (legend === null) return null;
              return (
                <li
                  key={fact.code + ":" + index}
                  className="flex gap-2 border-l-2 pl-2"
                  style={{ borderColor: "var(" + legend.colorToken + ")" }}
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium text-foreground">{t(legend.labelKey)}</p>
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      {t(legend.messageKey, fact.params)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
