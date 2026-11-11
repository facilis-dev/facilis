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

/**
 * Table surface of a workflow, derived from the jobs its steps reference (never declared):
 * the sorted union of the referenced jobs' own `dbTables` (tables and views alike).
 */
export interface WorkflowTablesFact {
  readonly name: string;
  readonly sourceFile: string;
  readonly source: SourceRef;
  /** Sorted unique union of the referenced jobs' declared dbTables. */
  readonly tables: readonly string[];
  /** Job-step names with no definition under `server/jobs/**`; [] when all resolve. */
  readonly unknownJobs: readonly string[];
  /** True when a referenced job's dbTables is unreadable, so the union is incomplete. */
  readonly unknown: boolean;
}
