// The selected node's diagnosis callout (D-212, #189): every analyzer diagnostic for that node,
// resolved through t(code, params) so an en/it switch re-translates in place without a reload.
// It sits inside the existing drawer, so selecting a flagged answer reuses the #187 path.

import type { GraphDiagnostic } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import {
  DIAGNOSTIC_COLOR_TOKENS,
  DIAGNOSTIC_LABEL_KEYS,
  DIAGNOSTIC_MESSAGE_KEYS,
  diagnosticParams,
} from "@/facilis/graph-surface/lenses.ts";

export function ProjectGraphDiagnosisCallout({
  diagnostics,
}: {
  diagnostics: readonly GraphDiagnostic[];
}) {
  if (diagnostics.length === 0) return null;
  return (
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
  );
}
