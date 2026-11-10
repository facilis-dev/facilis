// Row <-> store-contract mapping for manual tasks (D-135).
//
// Kept apart from db-store.ts so each file stays well under the 300-line limit and the text
// status/decision columns are decoded in exactly one place.
import { TASK_DECISIONS, TASK_KINDS, TASK_STATUSES } from "@facilis/core";
import type { JobJson, TaskDecision, TaskKind, TaskRecord, TaskStatus } from "@facilis/core";
import type { FacilisTaskRow } from "@facilis/db";

import type { StoredTask } from "./contracts.ts";

/** Maps a row to the store contract; JSONB columns are TaskJson by construction. */
export function toStoredTask(row: FacilisTaskRow): StoredTask {
  return {
    id: row.id,
    workflowId: row.workflowId,
    stepIndex: row.stepIndex,
    kind: toTaskKind(row.kind),
    status: toTaskStatus(row.status),
    decision: row.decision === null ? null : toTaskDecision(row.decision),
    titleKey: row.titleKey,
    titleParams: row.titleParams as JobJson,
    payload: (row.payload ?? null) as JobJson | null,
    requestedBy: row.requestedBy,
    assignedPermission: row.assignedPermission,
    expiresAt: row.expiresAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

/** The API record: JSON-friendly timestamps, JSON data. */
export function toTaskRecord(task: StoredTask): TaskRecord {
  return {
    id: task.id,
    workflowId: task.workflowId,
    stepIndex: task.stepIndex,
    kind: task.kind,
    status: task.status,
    decision: task.decision,
    titleKey: task.titleKey,
    titleParams: task.titleParams,
    payload: task.payload,
    requestedBy: task.requestedBy,
    assignedPermission: task.assignedPermission,
    expiresAt: task.expiresAt === null ? null : task.expiresAt.toISOString(),
    decidedBy: task.decidedBy,
    decidedAt: task.decidedAt === null ? null : task.decidedAt.toISOString(),
    comment: task.comment,
    createdAt: task.createdAt.toISOString(),
  };
}

/** Narrows the text status column; an unknown value is corrupt row data, not a task. */
export function toTaskStatus(value: string): TaskStatus {
  for (const status of TASK_STATUSES) {
    if (status === value) return status;
  }
  throw new Error('facilis_tasks: unknown status "' + value + '"');
}

export function toTaskKind(value: string): TaskKind {
  for (const kind of TASK_KINDS) {
    if (kind === value) return kind;
  }
  throw new Error('facilis_tasks: unknown kind "' + value + '"');
}

export function toTaskDecision(value: string): TaskDecision {
  for (const decision of TASK_DECISIONS) {
    if (decision === value) return decision;
  }
  throw new Error('facilis_tasks: unknown decision "' + value + '"');
}
