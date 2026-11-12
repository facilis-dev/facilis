// Workflow inspector: the definition's steps in order, and the database surface derived from
// the jobs those steps reference (a workflow never declares its own dbTables).

import { tableId } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import type { WorkflowDetails } from "@/facilis/graph-details";
import { Chip, DetailsSection, EmptyNote, NodeSelectChip } from "./ProjectGraphDetailsSection";
import { ProjectGraphSourcePreview } from "./ProjectGraphSourcePreview";

export interface ProjectGraphWorkflowDetailsProps {
  node: ProjectGraphNode;
  details: WorkflowDetails | null;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  onOpenFileAt: (file: string, line: number) => void;
  onSelectNode: (id: string) => void;
}

export function ProjectGraphWorkflowDetails({
  node,
  details,
  sources,
  nodeLabel,
  onOpenFileAt,
  onSelectNode,
}: ProjectGraphWorkflowDetailsProps) {
  if (node.data.kind !== "workflow") return null;
  const workflow = node.data;
  const tables = details?.tables ?? [];
  const unknownJobs = details?.unknownJobs ?? [];
  const unknown = details?.unknown === true;
  return (
    <>
      <p className="truncate font-mono text-[11px]">{workflow.name}</p>
      <DetailsSection title={t("projectGraph.workflow.title")}>
        {workflow.steps.length === 0 ? (
          <EmptyNote message={t("projectGraph.workflow.empty")} />
        ) : (
          <ol className="space-y-1">
            {workflow.steps.map((step) => (
              <li key={step.index} className="rounded border px-1.5 py-0.5">
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-[9px] text-muted-foreground">
                    {step.index + 1}.
                  </span>
                  <Chip>{t(("projectGraph.workflow." + step.kind) as MessageKey)}</Chip>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                    {step.name ?? "?"}
                  </span>
                </div>
                {(step.permission !== null || step.onRejectStep !== null) && (
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    {step.permission !== null &&
                      t("projectGraph.workflow.permission", { permission: step.permission })}
                    {step.permission !== null && step.onRejectStep !== null ? " · " : ""}
                    {step.onRejectStep !== null &&
                      t("projectGraph.workflow.onReject", { step: step.onRejectStep + 1 })}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.workflowTables")}>
        {tables.length === 0 ? (
          unknown ? (
            <Chip tone="warning">{t("projectGraph.unknown")}</Chip>
          ) : (
            <EmptyNote message={t("projectGraph.empty.tables")} />
          )
        ) : (
          <ul className="flex flex-wrap gap-1">
            {tables.map((name) => (
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
        {unknown && tables.length > 0 && (
          <p className="flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
            <Chip tone="warning">{t("projectGraph.unknown")}</Chip>
          </p>
        )}
        {unknownJobs.length > 0 && (
          <p className="flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
            <span className="font-mono">{unknownJobs.join(", ")}</span>
            <Chip tone="warning">{t("projectGraph.unknown")}</Chip>
          </p>
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
