// Workflow node data: the analyzer's workflow `GraphNode` facts mapped onto the view model's
// WorkflowGraphData, plus the search predicate for them. Split from graph-model.ts (and from
// graph-model-data.ts, which owns the other kinds) so every file stays under the 300-line
// source limit. Pure data mapping: no layout, no React.

import type { GraphNode } from "@facilis.dev/analyze";
import { matchesQuery } from "./graph-model-data";
import type { ProjectGraphNode, WorkflowGraphData } from "./graph-types";

export function workflowData(node: GraphNode): WorkflowGraphData | null {
  if (node.data.kind !== "workflow") return null;
  return {
    kind: "workflow",
    name: node.data.name,
    steps: node.data.steps.map((step) => ({
      index: step.index,
      kind: step.kind,
      name: step.name,
      permission: step.permission,
      onRejectStep: step.onRejectStep,
    })),
    unknown: node.data.unknown,
  };
}

/**
 * The generic predicate in graph-model-data.ts handles every schema object kind; workflow
 * facts live outside its switch, so their steps get their own values here.
 */
export function matchesNodeQuery(node: ProjectGraphNode, needle: string): boolean {
  if (node.data.kind !== "workflow") return matchesQuery(node, needle);
  if (needle.length === 0) return true;
  const values: string[] = [node.label, node.id, node.sourceFile ?? "", node.data.name];
  for (const step of node.data.steps) {
    values.push(step.kind, step.name ?? "");
    if (step.permission !== null) values.push(step.permission);
  }
  return values.some((value) => value.toLowerCase().includes(needle));
}
