// View body of the rich card (issue #188): the declared access mode and permission plus the base
// tables the view reads. Unknown access is labelled, never guessed.

import { t, type MessageKey } from "@/i18n";
import type { ViewGraphData } from "@/facilis/graph-model";
import { capList } from "@/facilis/graph-surface/card-facts";
import { Chip, DetailsSection, EmptyNote, NodeSelectChip } from "./ProjectGraphDetailsSection";

export function ProjectGraphRichCardView({
  view,
  nodeLabel,
  onSelectNode,
}: {
  view: ViewGraphData;
  nodeLabel: (id: string) => string | null;
  onSelectNode: (id: string) => void;
}) {
  const tables = capList(view.tables);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Chip>
          {view.access === null
            ? t("projectGraph.unknown")
            : t(("projectGraph.access." + view.access) as MessageKey)}
        </Chip>
        <Chip mono tone="info">
          {view.permission ?? t("projectGraph.public")}
        </Chip>
        {view.unknown && <Chip tone="warning">{t("projectGraph.unknown")}</Chip>}
      </div>
      <p className="truncate font-mono text-[11px]">{view.view}</p>
      <DetailsSection title={t("projectGraph.baseTables")}>
        {tables.visible.length === 0 ? (
          <EmptyNote message={t("projectGraph.noBaseTables")} />
        ) : (
          <div className="flex flex-wrap gap-1">
            {tables.visible.map((name) => (
              <NodeSelectChip
                key={name}
                id={"table:" + name}
                text={name}
                nodeLabel={nodeLabel}
                onSelect={onSelectNode}
              />
            ))}
            {tables.hidden > 0 && (
              <Chip tone="muted">
                {t("projectGraph.surface.card.more", { count: tables.hidden })}
              </Chip>
            )}
          </div>
        )}
      </DetailsSection>
    </>
  );
}
