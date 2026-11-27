// The analyzer lenses' banner plus the chrome every lens banner shares (D-220, #189; state
// lenses D-225, #199), so a new lens never forks the bar, the legend or the answer list. Every
// string is a t() key and every colour is a semantic token declared by the lens registry.

import type { ReactNode } from "react";
import type { I18nParams } from "@facilis.dev/core/i18n";
import { t, type MessageKey } from "@/i18n";
import {
  DIAGNOSTIC_MESSAGE_KEYS,
  diagnosticParams,
  type GraphLensDefinition,
  type GraphLensSummary,
} from "@/facilis/graph-surface/lenses.ts";

export interface LensLine {
  readonly key: MessageKey;
  readonly params: I18nParams;
  /** null keeps the neutral answer ink (the analyzer lenses render unchanged). */
  readonly colorToken: string | null;
}

export interface LensRow {
  readonly nodeId: string;
  readonly lines: readonly LensLine[];
  /** Domain heading for grouped state lenses; null renders a flat row. */
  readonly group?: string | null;
}

export function LensSection({
  definition,
  onClose,
  children,
}: {
  definition: GraphLensDefinition;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
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
      {children}
    </section>
  );
}

export function LensLegend({
  definition,
  total,
  context,
}: {
  definition: GraphLensDefinition;
  total: string | null;
  context: string | null;
}) {
  return (
    <>
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
        {total !== null && (
          <span
            data-testid="project-graph-lens-count"
            className="ml-auto rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
          >
            {total}
          </span>
        )}
      </div>
      {context !== null && (
        <p
          data-testid="project-graph-lens-window"
          className="px-2 pb-1 text-[10px] text-muted-foreground"
        >
          {context}
        </p>
      )}
    </>
  );
}

export function EmptyState({
  title,
  hint,
  onClose,
}: {
  title: string;
  hint: string | null;
  onClose: () => void;
}) {
  return (
    <div data-testid="project-graph-lens-empty" className="border-t px-2 py-2" role="status">
      <p className="text-[11px] font-medium text-foreground">{title}</p>
      {hint !== null && (
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-1 rounded border px-2 py-0.5 text-[10px] text-foreground hover:bg-accent/10"
      >
        {t("projectGraph.surface.lens.emptyLeave")}
      </button>
    </div>
  );
}

export function AnswerList({
  rows,
  nodeLabel,
  onActivate,
}: {
  rows: readonly LensRow[];
  nodeLabel: (id: string) => string | null;
  onActivate: (nodeId: string) => void;
}) {
  return (
    <ul
      aria-label={t("projectGraph.surface.lens.answers")}
      className="max-h-52 overflow-auto border-t"
    >
      {rows.map((row, rowIndex) => (
        <li key={row.nodeId} className="border-b last:border-b-0">
          {row.group !== undefined &&
            row.group !== null &&
            row.group !== rows[rowIndex - 1]?.group && (
              <p className="px-2 pt-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                {row.group}
              </p>
            )}
          <button
            type="button"
            data-testid={"project-graph-lens-answer-" + row.nodeId}
            onClick={() => onActivate(row.nodeId)}
            className="block w-full px-2 py-1.5 text-left hover:bg-accent/10"
          >
            <span className="block truncate text-[11px] font-medium text-foreground">
              {nodeLabel(row.nodeId) ?? row.nodeId}
            </span>
            {row.lines.map((line, index) => (
              <span
                key={line.key + ":" + index}
                className="mt-0.5 block text-[10px] leading-snug"
                style={
                  line.colorToken === null ? undefined : { color: "var(" + line.colorToken + ")" }
                }
              >
                {t(line.key, line.params)}
              </span>
            ))}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProjectGraphLensBanner({
  definition,
  summary,
  nodeLabel,
  onClose,
  onActivate,
}: {
  definition: GraphLensDefinition;
  summary: GraphLensSummary;
  nodeLabel: (id: string) => string | null;
  onClose: () => void;
  onActivate: (nodeId: string) => void;
}) {
  const rows: LensRow[] = [...summary.byNode.entries()].map(([nodeId, entries]) => ({
    nodeId,
    lines: entries.map((entry) => ({
      key: DIAGNOSTIC_MESSAGE_KEYS[entry.code],
      params: diagnosticParams(entry),
      colorToken: null,
    })),
  }));
  return (
    <LensSection definition={definition} onClose={onClose}>
      <LensLegend
        definition={definition}
        total={t("projectGraph.surface.lens.count", { count: summary.count })}
        context={null}
      />
      {summary.count === 0 ? (
        <EmptyState
          title={t("projectGraph.surface.lens.emptyTitle")}
          hint={t("projectGraph.surface.lens.emptyHint", { lens: t(definition.titleKey) })}
          onClose={onClose}
        />
      ) : (
        <AnswerList rows={rows} nodeLabel={nodeLabel} onActivate={onActivate} />
      )}
    </LensSection>
  );
}
