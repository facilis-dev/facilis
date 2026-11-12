// Table inspector: the schema facts the analyzer read (columns with their markers, RLS and
// scope, policies, foreign keys, relations) plus the routes that use the table.

import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import type { ColumnDetails, TableDetails } from "@/facilis/graph-details";
import {
  Chip,
  DetailsSection,
  EmptyNote,
  NodeSelectChip,
  type ChipTone,
} from "./ProjectGraphDetailsSection";
import { ProjectGraphSourcePreview } from "./ProjectGraphSourcePreview";

/** One column row: its SQL name, the Drizzle property when they differ, and its markers. */
function ColumnRow({
  column,
  onOpenFileAt,
}: {
  column: ColumnDetails;
  onOpenFileAt: (file: string, line: number) => void;
}) {
  // The column's own SourceRef opens the exact DDL line: the row is the code jump.
  return (
    <li>
      <button
        type="button"
        title={t("projectGraph.openAtLine", { line: column.source.line })}
        className="w-full rounded border px-1.5 py-0.5 text-left hover:bg-accent/40"
        onClick={() => onOpenFileAt(column.source.file, column.source.line)}
      >
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="truncate font-mono text-[10px]">{column.name}</span>
          {column.property !== column.name && (
            <span className="truncate text-[9px] text-muted-foreground">{column.property}</span>
          )}
          <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">{column.type}</span>
        </div>
        <div className="flex flex-wrap gap-1 pt-0.5">
          {column.primaryKey && <Chip mono>{t("projectGraph.marker.primaryKey")}</Chip>}
          {column.notNull && <Chip mono>{t("projectGraph.marker.notNull")}</Chip>}
          {column.unique && <Chip mono>{t("projectGraph.marker.unique")}</Chip>}
          {column.default !== null && (
            <Chip mono title={column.default.value ?? undefined}>
              {t("projectGraph.marker.default")}
            </Chip>
          )}
        </div>
      </button>
    </li>
  );
}

export interface ProjectGraphTableDetailsProps {
  node: ProjectGraphNode;
  edges: readonly ProjectGraphEdge[];
  details: TableDetails | null;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  onOpenFileAt: (file: string, line: number) => void;
  onSelectNode: (id: string) => void;
}

export function ProjectGraphTableDetails({
  node,
  edges,
  details,
  sources,
  nodeLabel,
  onOpenFileAt,
  onSelectNode,
}: ProjectGraphTableDetailsProps) {
  if (node.data.kind !== "table") return null;
  const table = node.data;
  const columns = details?.columns ?? [];
  const policies = details?.policies ?? [];
  const foreignKeys = details?.foreignKeys ?? [];
  const relations = details?.relations ?? [];
  const usedBy = edges.filter((edge) => edge.kind === "route-table" && edge.target === node.id);
  const scopeKind =
    table.scope === null ? null : t(("projectGraph.scopeKind." + table.scope.kind) as MessageKey);
  const badges: { key: string; label: string; tone: ChipTone }[] = [
    table.rlsEnabled
      ? { key: "rls", label: t("projectGraph.rls"), tone: "info" }
      : { key: "system", label: t("projectGraph.systemOnly"), tone: "warning" },
  ];
  if (table.scope !== null && scopeKind !== null) {
    badges.push({
      key: "scope",
      label: t("projectGraph.scope", { column: table.scope.column, kind: scopeKind }),
      tone: "muted",
    });
  }
  if (table.framework)
    badges.push({ key: "framework", label: t("projectGraph.framework"), tone: "muted" });
  if (table.unknown)
    badges.push({ key: "unknown", label: t("projectGraph.unknown"), tone: "warning" });
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {badges.map((badge) => (
          <Chip key={badge.key} tone={badge.tone}>
            {badge.label}
          </Chip>
        ))}
      </div>
      <p className="truncate font-mono text-[11px]">{table.table}</p>
      <DetailsSection title={t("projectGraph.section.columns")}>
        {columns.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.columns")} />
        ) : (
          <ul className="space-y-0.5">
            {columns.map((column) => (
              <ColumnRow key={column.property} column={column} onOpenFileAt={onOpenFileAt} />
            ))}
          </ul>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.policies")}>
        {policies.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.policies")} />
        ) : (
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
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.foreignKeys")}>
        {foreignKeys.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.foreignKeys")} />
        ) : (
          <ul className="space-y-0.5">
            {foreignKeys.map((foreignKey) => (
              <li
                key={
                  foreignKey.targetTable +
                  "\u0000" +
                  foreignKey.columns.join(",") +
                  "\u0000" +
                  foreignKey.targetColumns.join(",")
                }
                className="rounded border px-1.5 py-0.5"
              >
                <p className="truncate font-mono text-[9px]">
                  {t("projectGraph.fk.edge", {
                    columns: foreignKey.columns.join(", "),
                    table: foreignKey.targetTable,
                    references: foreignKey.targetColumns.join(", "),
                  })}
                </p>
                {foreignKey.onDelete !== null && (
                  <p className="text-[9px] text-muted-foreground">
                    {t("projectGraph.fk.onDelete", { action: foreignKey.onDelete })}
                  </p>
                )}
                {foreignKey.onUpdate !== null && (
                  <p className="text-[9px] text-muted-foreground">
                    {t("projectGraph.fk.onUpdate", { action: foreignKey.onUpdate })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.relations")}>
        {relations.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.relations")} />
        ) : (
          <ul className="space-y-0.5">
            {relations.map((relation, index) => (
              <li
                key={relation.from + "\u0000" + relation.to + "\u0000" + String(index)}
                className="rounded border px-1.5 py-0.5 font-mono text-[9px]"
              >
                <span className="block truncate">
                  {relation.from} → {relation.to}
                </span>
                <span className="block truncate text-muted-foreground">
                  {relation.fields.join(", ")} → {relation.references.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.usedBy")}>
        {usedBy.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.usedBy")} />
        ) : (
          <ul className="flex flex-wrap gap-1">
            {usedBy.map((edge) => (
              <li key={edge.id}>
                <NodeSelectChip
                  id={edge.source}
                  nodeLabel={nodeLabel}
                  onSelect={onSelectNode}
                  text={nodeLabel(edge.source) ?? edge.source}
                />
              </li>
            ))}
          </ul>
        )}
      </DetailsSection>
      <ProjectGraphSourcePreview
        file={details?.source?.file ?? node.sourceFile}
        line={details?.source?.line ?? null}
        sources={sources}
        onOpenFileAt={onOpenFileAt}
      />
    </>
  );
}
