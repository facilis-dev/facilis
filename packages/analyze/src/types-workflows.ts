// Workflow fact shapes, split from types.ts so the base fact model stays under the 300-line
// source limit (D-135 W3). They are re-exported from types.ts, so existing imports keep working.

import type { SourceRef, UnknownFact } from "./types.ts";

/** One step of a `defineWorkflow` chain, as the static subset reads it. */
export interface WorkflowStepFact {
  readonly index: number;
  readonly kind: "job" | "approval";
  /** Job name for a job step, approval title key for an approval step. */
  readonly name: string | null;
  /** Approval assignment permission, when the definition declares one. */
  readonly permission: string | null;
  /** Forward step index declared by `onReject.step`, when present. */
  readonly onRejectStep: number | null;
  readonly source: SourceRef;
}

/** One `server/workflows/**` definition. */
export interface WorkflowFact {
  readonly name: string;
  readonly sourceFile: string;
  readonly source: SourceRef;
  readonly steps: readonly WorkflowStepFact[];
  readonly unknown: readonly UnknownFact[];
}
