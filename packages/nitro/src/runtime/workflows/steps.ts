// Step helpers shared by the API and the runner (D-135, docs/WORKFLOWS.md §6-§8).
import type {
  JobJson,
  WorkflowDefinition,
  WorkflowProgressEntry,
  WorkflowResolveContext,
  WorkflowStep,
  WorkflowStepIdentity,
} from "@facilis/core";
import { WorkflowError } from "@facilis/core";

/** The plan-snapshot identity of a step: kind plus the name a resume compares against. */
export function stepIdentity(step: WorkflowStep, index: number): WorkflowStepIdentity {
  return "job" in step
    ? { index, kind: "job", name: step.job }
    : { index, kind: "approval", name: step.approval.titleKey };
}

/** True when the stored plan still describes the definition's step at `index`. */
export function planMatches(
  plan: readonly WorkflowStepIdentity[],
  definition: WorkflowDefinition,
  index: number,
): boolean {
  const step = definition.steps[index];
  if (step === undefined) return false;
  const expected = stepIdentity(step, index);
  const stored = plan[index];
  return stored !== undefined && stored.kind === expected.kind && stored.name === expected.name;
}

/** Outputs of the completed steps in order; an approval step contributes null. */
export function stepOutputs(
  progress: readonly WorkflowProgressEntry[],
  count: number,
): (JobJson | null)[] {
  const outputs: (JobJson | null)[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = progress.find((candidate) => candidate.index === index);
    outputs.push(entry?.output ?? null);
  }
  return outputs;
}

/** The resolver context for the step at `index`: chain input plus completed outputs. */
export function resolveContext(
  input: JobJson,
  progress: readonly WorkflowProgressEntry[],
  index: number,
): WorkflowResolveContext {
  return { input, steps: stepOutputs(progress, index) };
}

/**
 * Validates a resolved approval `params` value: a flat JSON object of string/number
 * values, exactly what `t(titleKey, params)` can interpolate.
 */
export function normalizeTitleParams(value: unknown): Record<string, string | number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkflowError("workflow_step_failed", "Approval params must resolve to an object.");
  }
  const params: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") params[key] = entry;
    else if (typeof entry === "number" && Number.isFinite(entry)) params[key] = entry;
    else {
      throw new WorkflowError(
        "workflow_step_failed",
        `Approval param "${key}" must be a string or a finite number.`,
      );
    }
  }
  return params;
}
