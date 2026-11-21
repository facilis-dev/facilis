// The project-graph workflow card: the workflow name, its step count and the first steps with
// their kind badges (the list truncates with a "more" hint). Split from ProjectGraphNodes.tsx
// for the 300-line source limit; the node-type registry stays there.

import { useContext } from "react";
import type { NodeProps } from "@xyflow/react";
import WorkflowIcon from "~icons/lucide/workflow";
import { t, type MessageKey } from "@/i18n";
import {
  LinkHandles,
  TurnBadge,
  UnknownBadge,
  nodeClass,
  turnSourceTitle,
} from "./ProjectGraphNodeChrome";
import {
  ContractLensContext,
  NodeDiagnosticsMarks,
  contractRingClass,
} from "./ProjectGraphContractMarks";
import type { ProjectAnalysisFlowNode } from "./ProjectGraphNodes";
import { GraphLodOverlay, ProjectGraphLodContent, lodSizerClass } from "./ProjectGraphLod";
import { useGraphLod } from "./use-graph-lod";

const MAX_VISIBLE_WORKFLOW_STEPS = 4;

export function WorkflowGraphNode({
  data,
  selected,
  dragging,
}: NodeProps<ProjectAnalysisFlowNode>) {
  // The contract lens (issue #69): workflows carry only attached diagnostics, like pages.
  const contract = useContext(ContractLensContext);
  const level = useGraphLod();
  const node = data.node;
  const workflow = node.data.kind === "workflow" ? node.data : null;
  if (workflow === null) return null;
  const diagnostics = contract?.nodeDiagnostics.get(node.id) ?? [];
  const shown = workflow.steps.slice(0, MAX_VISIBLE_WORKFLOW_STEPS);
  const more = workflow.steps.length - shown.length;
  return (
    <div
      data-testid="project-graph-workflow"
      data-lod={level}
      title={turnSourceTitle(node, data.turn)}
      className={
        nodeClass(
          selected,
          node.matched,
          dragging,
          data.focused,
          data.isolated,
          data.aiOutlined,
          data.auditDimmed,
          contract === null ? "" : contractRingClass(diagnostics),
          data.turn,
          data.impactDimmed,
        ) + " relative w-64"
      }
    >
      <div className={lodSizerClass(level)} aria-hidden={level !== "full"}>
        <div className="flex items-center gap-1.5">
          <WorkflowIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
            {workflow.name}
          </span>
          {data.turn != null && <TurnBadge turn={data.turn} />}
          {workflow.unknown && <UnknownBadge />}
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {t("projectGraph.workflow.steps", { count: workflow.steps.length })}
          </span>
        </div>
        {shown.length > 0 && (
          <ul className="mt-1 space-y-0.5 border-t pt-1">
            {shown.map((step) => (
              <li key={step.index} className="flex items-center gap-1 text-[10px]">
                <span className="shrink-0 text-muted-foreground">{step.index + 1}.</span>
                <span className="shrink-0 rounded border px-1 text-muted-foreground">
                  {t(("projectGraph.workflow." + step.kind) as MessageKey)}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{step.name ?? "?"}</span>
              </li>
            ))}
          </ul>
        )}
        {more > 0 && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {t("projectGraph.workflow.more", { count: more })}
          </p>
        )}
      </div>
      {contract !== null && (
        <NodeDiagnosticsMarks
          diagnostics={diagnostics}
          compact={contract.compact}
          secondary={contract.secondary}
        />
      )}
      {level !== "full" && (
        <GraphLodOverlay>
          <ProjectGraphLodContent
            node={node}
            edgeCount={data.edgeCount}
            level={level}
            turn={data.turn}
          />
        </GraphLodOverlay>
      )}
      <LinkHandles />
    </div>
  );
}
