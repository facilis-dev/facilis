// View inspector: the security mode and permission the view declares, the base tables it
// reads and the routes that name it in their dbTables (incoming route-view edges).

import { tableId } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import type { ViewDetails } from "@/facilis/graph-details";
import { Chip, DetailsSection, EmptyNote, NodeSelectChip } from "./ProjectGraphDetailsSection";
import { ProjectGraphSourcePreview } from "./ProjectGraphSourcePreview";

export interface ProjectGraphViewDetailsProps {
  node: ProjectGraphNode;
  details: ViewDetails | null;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  onOpenFileAt: (file: string, line: number) => void;
  onSelectNode: (id: string) => void;
}

export function ProjectGraphViewDetails({
  node,
  details,
  sources,
  nodeLabel,
  onOpenFileAt,
  onSelectNode,
}: ProjectGraphViewDetailsProps) {
  if (node.data.kind !== "view") return null;
  const view = node.data;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Chip>{t("projectGraph.node.view")}</Chip>
        {view.access !== null && (
          <Chip tone={view.access === "definer" ? "warning" : "muted"}>
            {t(("projectGraph.access." + view.access) as MessageKey)}
          </Chip>
        )}
        <Chip mono tone="info">
          {view.permission ?? t("projectGraph.public")}
        </Chip>
        {view.unknown && <Chip tone="warning">{t("projectGraph.unknown")}</Chip>}
      </div>
      <p className="truncate font-mono text-[11px]">{view.view}</p>
      <DetailsSection title={t("projectGraph.baseTables")}>
        {view.tables.length === 0 ? (
          <EmptyNote message={t("projectGraph.noBaseTables")} />
        ) : (
          <ul className="flex flex-wrap gap-1">
            {view.tables.map((name) => (
              <li key={name}>
                <NodeSelectChip
                  id={tableId(name)}
                  text={name}
                  nodeLabel={nodeLabel}
                  onSelect={onSelectNode}
                />
              </li>
            ))}
          </ul>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.usedByRoutes")}>
        {view.usedByRoutes.length === 0 ? (
          <EmptyNote message={t("projectGraph.noUsedByRoutes")} />
        ) : (
          <ul className="flex flex-wrap gap-1">
            {view.usedByRoutes.map((usedBy) => (
              <li key={usedBy.id}>
                <NodeSelectChip
                  id={usedBy.id}
                  text={usedBy.label}
                  nodeLabel={nodeLabel}
                  onSelect={onSelectNode}
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
