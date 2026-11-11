// `server/workflows/**` definitions -> WorkflowFacts (docs/WORKFLOWS.md §6, D-135).
//
// The default export is the only source: a `defineWorkflow()` call from `@facilis.dev/core`
// whose argument is an object literal. Resolvers (`input`, `params`) are functions, so the
// reader takes the static fields one by one instead of evaluating the whole definition.

import {
  callArguments,
  identifierName,
  nodeArray,
  objectEntries,
  propertyName,
  propertyValue,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { warning } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import { evaluateStatic, type StaticContext } from "../static-eval.ts";
import type { Diagnostic, UnknownFact, WorkflowFact, WorkflowStepFact } from "../types.ts";
import {
  defaultExportExpression,
  isLocallyDeclared,
  isRecord,
  relativePath,
  sortDiagnostics,
} from "./static-read.ts";

const CORE_SPECIFIER = "@facilis.dev/core";
const WORKFLOW_DIR = "server/workflows/";
const STATIC_CODE = "workflow-definition-static";

export interface WorkflowResult {
  readonly workflows: readonly WorkflowFact[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Read every workflow definition the project declares; invalid files become warnings. */
export function buildWorkflowFacts(graph: ModuleGraph): WorkflowResult {
  const workflows: WorkflowFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of graph.files.values()) {
    const relative = relativePath(graph.root, file.path);
    if (!relative.startsWith(WORKFLOW_DIR) || relative.endsWith(".test.ts")) continue;
    scanFile(graph, file, workflows, diagnostics);
  }
  return { workflows, diagnostics: sortDiagnostics(diagnostics) };
}

function scanFile(
  graph: ModuleGraph,
  file: ProjectFile,
  workflows: WorkflowFact[],
  diagnostics: Diagnostic[],
): void {
  const context: StaticContext = { graph, file: file.path };
  const expression = defaultExportExpression(file);
  const ref = sourceRef(file.path, file.source, expression?.start ?? 0);
  const problem = definitionProblem(file, expression);
  if (problem !== null || expression === undefined || expression.type !== "CallExpression") {
    diagnostics.push(
      warning(
        "workflow-definition",
        problem ?? "the default export is not a defineWorkflow() call",
        ref,
      ),
    );
    return;
  }
  const literal = objectLiteral(callArguments(expression)[0]);
  if (literal === undefined) {
    diagnostics.push(
      warning("workflow-definition", "the definition argument is not an object literal", ref),
    );
    return;
  }
  const fields = fieldMap(literal);
  const name = staticString(fields.get("name"), context);
  if (name === null) {
    diagnostics.push(
      warning("workflow-definition", "the workflow name cannot be read statically", ref),
    );
    return;
  }
  const unknown: UnknownFact[] = [];
  const steps = readSteps(fields.get("steps"), context, file.path, file.source, unknown);
  workflows.push({ name, sourceFile: file.path, source: ref, steps, unknown });
}

/** The default export must be the `defineWorkflow` import from `@facilis.dev/core`. */
function definitionProblem(file: ProjectFile, expression: AstNode | undefined): string | null {
  if (expression === undefined) return "the workflow file has no default export";
  if (expression.type !== "CallExpression") {
    return "the default export is not a defineWorkflow() call";
  }
  const callee = unwrapExpression(expression.callee);
  const name = callee?.type === "Identifier" ? identifierName(callee) : undefined;
  if (name === undefined) return "the defineWorkflow callee cannot be resolved";
  if (isLocallyDeclared(file, name)) return '"' + name + '" is shadowed by a local declaration';
  const imported = file.module.imports.find((entry) => entry.local === name);
  if (
    imported === undefined ||
    imported.specifier !== CORE_SPECIFIER ||
    imported.imported !== "defineWorkflow"
  ) {
    return "the default export is not the defineWorkflow import from @facilis.dev/core";
  }
  return null;
}

function readSteps(
  node: AstNode | undefined,
  context: StaticContext,
  file: string,
  source: string,
  unknown: UnknownFact[],
): WorkflowStepFact[] {
  const array = node === undefined ? undefined : unwrapExpression(node);
  if (array === undefined || array.type !== "ArrayExpression") {
    unknown.push({
      code: STATIC_CODE,
      reason: "steps must be an array literal",
      source: sourceRef(file, source, array?.start ?? 0),
    });
    return [];
  }
  const steps: WorkflowStepFact[] = [];
  nodeArray(array, "elements").forEach((element, index) => {
    const ref = sourceRef(file, source, element.start ?? 0);
    const literal = objectLiteral(element);
    const fields = literal === undefined ? new Map<string, AstNode>() : fieldMap(literal);
    const job = fields.get("job");
    const approval = fields.get("approval");
    if (job !== undefined) {
      const name = staticString(job, context);
      unknownIfNull(unknown, ref, index, "job name", name);
      steps.push({ index, kind: "job", name, permission: null, onRejectStep: null, source: ref });
      return;
    }
    if (approval !== undefined) {
      const approvalLiteral = objectLiteral(approval);
      const approvalFields =
        approvalLiteral === undefined ? new Map<string, AstNode>() : fieldMap(approvalLiteral);
      const titleKey = staticString(approvalFields.get("titleKey"), context);
      const permission = staticString(approvalFields.get("permission"), context);
      const onRejectStep = rejectStepOf(approvalFields.get("onReject"), context);
      unknownIfNull(unknown, ref, index, "approval title key", titleKey);
      steps.push({
        index,
        kind: "approval",
        name: titleKey,
        permission,
        onRejectStep,
        source: ref,
      });
      return;
    }
    unknown.push({
      code: STATIC_CODE,
      reason: "step " + index + " is neither a job nor an approval",
      source: ref,
    });
  });
  return steps;
}

function rejectStepOf(node: AstNode | undefined, context: StaticContext): number | null {
  if (node === undefined) return null;
  const evaluated = evaluateStatic(node, context);
  if (!evaluated.ok || !isRecord(evaluated.value)) return null;
  const step = evaluated.value["step"];
  return typeof step === "number" && Number.isInteger(step) && step >= 0 ? step : null;
}

function unknownIfNull(
  unknown: UnknownFact[],
  ref: WorkflowFact["source"],
  index: number,
  label: string,
  value: string | null,
): void {
  if (value !== null) return;
  unknown.push({
    code: STATIC_CODE,
    reason: "step " + index + ": " + label + " cannot be read statically",
    source: ref,
  });
}

function staticString(node: AstNode | undefined, context: StaticContext): string | null {
  if (node === undefined) return null;
  const evaluated = evaluateStatic(node, context);
  return evaluated.ok && typeof evaluated.value === "string" && evaluated.value.length > 0
    ? evaluated.value
    : null;
}

function objectLiteral(node: AstNode | undefined): AstNode | undefined {
  const value = node === undefined ? undefined : unwrapExpression(node);
  return value?.type === "ObjectExpression" ? value : undefined;
}

function fieldMap(literal: AstNode): Map<string, AstNode> {
  const fields = new Map<string, AstNode>();
  for (const entry of objectEntries(literal)) {
    if (entry.type === "SpreadElement") continue;
    const key = propertyName(entry);
    const value = propertyValue(entry);
    if (key !== undefined && value !== undefined) fields.set(key, value);
  }
  return fields;
}
