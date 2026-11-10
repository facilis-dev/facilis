import type { z } from "zod";

/**
 * Authoring-time validation for workflow definitions (D-135, docs/WORKFLOWS.md §6).
 *
 * Split from workflows.ts to keep that contract file under the 300-line gate; these guards
 * run at module load (defineWorkflow) and in the registry (isWorkflowDefinition), never in
 * the request path.
 */

const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const JOB_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const TITLE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_TITLE_KEY_LENGTH = 200;

export function isWorkflowName(name: unknown): name is string {
  return typeof name === "string" && WORKFLOW_NAME_PATTERN.test(name);
}

export function assertWorkflowName(name: unknown): asserts name is string {
  if (!isWorkflowName(name)) {
    throw new TypeError(
      'Workflow name must match ^[a-z0-9][a-z0-9._-]*$ (lowercase, no spaces); got "' +
        String(name) +
        '".',
    );
  }
}

export function assertStep(workflow: string, step: unknown, index: number): void {
  if (!isStep(step, index)) {
    throw new TypeError(
      `Workflow "${workflow}" step ${index} must be { job } or { approval: { titleKey } }.`,
    );
  }
}

/** Structural step guard shared by `defineWorkflow` and `isWorkflowDefinition`. */
export function isStep(value: unknown, index: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { job?: unknown; approval?: unknown };
  const hasJob = candidate.job !== undefined;
  const hasApproval = candidate.approval !== undefined;
  // Exactly one kind per step: a mixed or empty step is a definition error, not a branch.
  if (hasJob === hasApproval) return false;
  if (hasJob) {
    if (typeof candidate.job !== "string" || !JOB_NAME_PATTERN.test(candidate.job)) return false;
    const input = (value as { input?: unknown }).input;
    return input === undefined || typeof input === "function";
  }
  const approval = candidate.approval;
  if (typeof approval !== "object" || approval === null) return false;
  const spec = approval as { titleKey?: unknown; params?: unknown; ttlMs?: unknown };
  if (
    typeof spec.titleKey !== "string" ||
    spec.titleKey.length === 0 ||
    spec.titleKey.length > MAX_TITLE_KEY_LENGTH ||
    !TITLE_KEY_PATTERN.test(spec.titleKey)
  ) {
    return false;
  }
  if (spec.params !== undefined && typeof spec.params !== "function") return false;
  if (spec.ttlMs !== undefined && (!Number.isInteger(spec.ttlMs) || (spec.ttlMs as number) < 1)) {
    return false;
  }
  return Number.isInteger(index);
}

export function isSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}
