// Table body of the rich card (issue #188): the RLS class and scope plus the FULL column list
// with type and PK/NN/UQ/DEF/FK markers. Columns are never truncated; the analyzer's unknown
// marker survives from either the analysis details or the graph node's own columns.

import { t, type MessageKey } from "@/i18n";
import type { TableDetails } from "@/facilis/graph-details";
import type { TableGraphData } from "@/facilis/graph-model";
import {
  tableCardColumns,
  type CardColumn,
  type CardColumnMarker,
} from "@/facilis/graph-surface/card-facts";
import { Chip, DetailsSection, EmptyNote } from "./ProjectGraphDetailsSection";

const MARKER_LABEL: Readonly<Record<CardColumnMarker, MessageKey>> = {
  pk: "projectGraph.surface.card.marker.pk",
  nn: "projectGraph.surface.card.marker.nn",
  uq: "projectGraph.surface.card.marker.uq",
  def: "projectGraph.surface.card.marker.def",
  fk: "projectGraph.surface.card.marker.fk",
  unknown: "projectGraph.surface.card.marker.unknown",
};

const MARKER_TITLE: Readonly<Record<CardColumnMarker, MessageKey>> = {
  pk: "projectGraph.marker.primaryKey",
  nn: "projectGraph.marker.notNull",
  uq: "projectGraph.marker.unique",
  def: "projectGraph.marker.default",
  fk: "projectGraph.marker.fk",
  unknown: "projectGraph.marker.unknown",
};

function ColumnRow({ column }: { column: CardColumn }) {
  return (
    <li className="rounded border px-1.5 py-0.5" data-testid="project-graph-rich-card-column">
      <div className="flex min-w-0 items-baseline gap-1">
        <span className="truncate font-mono text-[10px]">{column.name}</span>
        {column.property !== column.name && (
          <span className="truncate text-[9px] text-muted-foreground">{column.property}</span>
        )}
        <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">{column.type}</span>
      </div>
      {column.markers.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {column.markers.map((marker) => (
            <Chip key={marker} mono title={t(MARKER_TITLE[marker])}>
              {t(MARKER_LABEL[marker])}
            </Chip>
          ))}
        </div>
      )}
    </li>
  );
}

export function ProjectGraphRichCardTable({
  table,
  details,
}: {
  table: TableGraphData;
  details: TableDetails | null;
  nodeLabel: (id: string) => string | null;
  onSelectNode: (id: string) => void;
}) {
  const columns = tableCardColumns(table, details);
  const policies = details?.policies ?? [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Chip tone={table.rlsEnabled ? "muted" : "warning"}>
          {table.rlsEnabled ? t("projectGraph.surface.rls") : t("projectGraph.systemOnly")}
        </Chip>
        {table.scope !== null && (
          <Chip>
            {t("projectGraph.scope", {
              column: table.scope.column,
              kind: t(("projectGraph.scopeKind." + table.scope.kind) as MessageKey),
            })}
          </Chip>
        )}
        {table.framework && <Chip>{t("projectGraph.framework")}</Chip>}
        {table.unknown && <Chip tone="warning">{t("projectGraph.unknown")}</Chip>}
        {details === null && <Chip tone="warning">{t("projectGraph.surface.card.noDetails")}</Chip>}
      </div>
      <p className="truncate font-mono text-[11px]">{table.table}</p>
      <DetailsSection title={t("projectGraph.columns", { count: columns.length })}>
        {columns.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.columns")} />
        ) : (
          <ul className="space-y-0.5">
            {columns.map((column) => (
              <ColumnRow key={column.key} column={column} />
            ))}
          </ul>
        )}
      </DetailsSection>
      {policies.length > 0 && (
        <DetailsSection title={t("projectGraph.section.policies")}>
          <ul className="space-y-0.5">
            {policies.map((policy) => (
              <li
                key={policy.name}
                className="flex items-center gap-1 rounded border px-1.5 py-0.5"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{policy.name}</span>
                <Chip mono>{policy.command}</Chip>
                {policy.restrictive && (
                  <Chip tone="warning">{t("projectGraph.flag.restrictive")}</Chip>
                )}
              </li>
            ))}
          </ul>
        </DetailsSection>
      )}
    </>
  );
}
