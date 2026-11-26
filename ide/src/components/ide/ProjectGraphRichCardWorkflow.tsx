// Workflow body of the rich card (issue #188): the ordered step list with the job/approval kind,
// the assigned permission and the rejection target, plus the honest unknown state when a job
// definition could not be read.

import { t, type MessageKey } from "@/i18n";
import type { WorkflowDetails } from "@/facilis/graph-details";
import type { WorkflowGraphData } from "@/facilis/graph-model";
import { capList } from "@/facilis/graph-surface/card-facts";
import { Chip, DetailsSection, EmptyNote } from "./ProjectGraphDetailsSection";

const STEP_LIMIT = 32;

export function ProjectGraphRichCardWorkflow({
  workflow,
  details,
}: {
  workflow: WorkflowGraphData;
  details: WorkflowDetails | null;
  nodeLabel: (id: string) => string | null;
  onSelectNode: (id: string) => void;
}) {
  const steps = capList(workflow.steps, STEP_LIMIT);
  const unknown = details?.unknown === true;
  const unknownJobs = details?.unknownJobs ?? [];
  return (
    <>
      <p className="truncate font-mono text-[11px]">{workflow.name}</p>
      {(workflow.unknown || unknown || details === null) && (
        <div className="flex flex-wrap gap-1">
          <Chip tone="warning">{t("projectGraph.unknown")}</Chip>
          {details === null && (
            <Chip tone="warning">{t("projectGraph.surface.card.noDetails")}</Chip>
          )}
        </div>
      )}
      <DetailsSection title={t("projectGraph.workflow.title")}>
        {steps.visible.length === 0 ? (
          <EmptyNote message={t("projectGraph.workflow.empty")} />
        ) : (
          <ol className="space-y-1">
            {steps.visible.map((step) => (
              <li key={step.index} className="rounded border px-1.5 py-0.5">
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-[9px] text-muted-foreground">
                    {step.index + 1}.
                  </span>
                  <Chip>{t(("projectGraph.workflow." + step.kind) as MessageKey)}</Chip>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                    {step.name ?? t("projectGraph.unknown")}
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
            {steps.hidden > 0 && (
              <li>
                <Chip tone="muted">
                  {t("projectGraph.surface.card.more", { count: steps.hidden })}
                </Chip>
              </li>
            )}
          </ol>
        )}
      </DetailsSection>
      {unknownJobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
          <span className="font-mono">{unknownJobs.join(", ")}</span>
          <Chip tone="warning">{t("projectGraph.unknown")}</Chip>
        </div>
      )}
    </>
  );
}
