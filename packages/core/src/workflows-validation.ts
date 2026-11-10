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
const PERMISSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const MAX_PERMISSION_LENGTH = 100;

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
  const spec = approval as {
    titleKey?: unknown;
    params?: unknown;
    ttlMs?: unknown;
    permission?: unknown;
    onReject?: unknown;
  };
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
  if (spec.permission !== undefined && !isPermission(spec.permission)) return false;
  if (spec.onReject !== undefined) {
    if (typeof spec.onReject !== "object" || spec.onReject === null) return false;
    const target = (spec.onReject as { step?: unknown }).step;
    if (typeof target !== "number" || !Number.isInteger(target) || target < 0) return false;
  }
  return Number.isInteger(index);
}

export function isPermission(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PERMISSION_LENGTH &&
    PERMISSION_PATTERN.test(value)
  );
}

/** Reads a step's `onReject.step`, ignoring structurally invalid definitions. */
function rejectTargetOf(step: unknown): unknown {
  if (typeof step !== "object" || step === null) return undefined;
  const approval = (step as { approval?: unknown }).approval;
  if (typeof approval !== "object" || approval === null) return undefined;
  const onReject = (approval as { onReject?: unknown }).onReject;
  if (typeof onReject !== "object" || onReject === null) return undefined;
  return (onReject as { step?: unknown }).step;
}

/**
 * A reject branch may only jump forward: progress entries are appended in index order, so a
 * target at or before the approval would replay completed steps (loops are out of scope).
 */
export function hasValidRejectTargets(steps: readonly unknown[]): boolean {
  return steps.every((step, index) => {
    const target = rejectTargetOf(step);
    if (target === undefined) return true;
    return typeof target === "number" && target > index && target < steps.length;
  });
}

export function assertRejectTargets(workflow: string, steps: readonly unknown[]): void {
  if (hasValidRejectTargets(steps)) return;
  steps.forEach((step, index) => {
    const target = rejectTargetOf(step);
    if (target === undefined) return;
    if (
      typeof target !== "number" ||
      !Number.isInteger(target) ||
      target <= index ||
      target >= steps.length
    ) {
      throw new TypeError(
        `Workflow "${workflow}" step ${index}: onReject.step must be a later step index (< ${steps.length}).`,
      );
    }
  });
}

export function isSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}
