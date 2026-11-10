// The server-only task API (D-135, docs/WORKFLOWS.md §7).
//
// Validation, JSON serialization and error classification live here; the store only knows
// rows. A decision is a compare-and-set on the task row: who decided, when and with what
// comment are recorded in one atomic write, and the decider's identity comes from the
// request context bound by the route wrapper, never from the request body.
import { randomUUID } from "node:crypto";

import { TaskError, serializeTaskData } from "@facilis/core";
import type {
  RequestTaskInput,
  TaskActorContext,
  TaskDecisionInput,
  TaskJson,
  TaskListOptions,
  TaskRecord,
  TasksApi,
} from "@facilis/core";
import type { PolicyScopedDatabase } from "@facilis/db";

import type { NewStoredTask, TaskListFilters, TaskStore } from "./contracts.ts";
import { toTaskRecord } from "./row-mapping.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TITLE_KEY_LENGTH = 200;
const MAX_COMMENT_LENGTH = 1000;
const TITLE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PERMISSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const MAX_PERMISSION_LENGTH = 100;

/**
 * Adapts a TaskStore to the handler-facing API. The actor is the session user id (or null
 * for a system-created task); bindScope re-binds both the transaction and the actor.
 */
export function createTasksApi(
  store: TaskStore,
  context: TaskActorContext = { actor: null },
): TasksApi {
  const api: TasksApi = {
    async request(input: RequestTaskInput): Promise<TaskRecord> {
      const task = normalizeTask(input, context.actor);
      await store.insert(task);
      const stored = await store.get(task.id);
      if (stored === null) throw new TaskError("task_not_found", "The task was not persisted.");
      return toTaskRecord(stored);
    },

    async get(id: string): Promise<TaskRecord | null> {
      const task = await store.get(id);
      return task === null ? null : toTaskRecord(task);
    },

    async list(options: TaskListOptions = {}): Promise<TaskRecord[]> {
      return (await store.list(normalizeFilters(options))).map(toTaskRecord);
    },

    async decide(id: string, decision: TaskDecisionInput): Promise<TaskRecord> {
      const kind = decision?.kind;
      if (kind !== "approve" && kind !== "reject") {
        throw invalid('decision.kind must be "approve" or "reject".');
      }
      const comment = normalizeComment(decision.comment);
      const now = new Date();
      const updated = await store.decide(id, {
        decision: kind,
        decidedBy: context.actor,
        comment,
        now,
      });
      if (updated !== null) return toTaskRecord(updated);
      // The CAS matched nothing: classify why, lazily expiring the row when its instant passed.
      const row = await store.get(id);
      if (row === null) throw new TaskError("task_not_found", "Task " + id + " does not exist.");
      if (row.status === "pending") {
        if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) {
          await store.expire(id, now);
          throw new TaskError("task_expired", "Task " + id + " expired before it was decided.");
        }
        // Another decider won the CAS between the read and the update.
        throw new TaskError("task_already_decided", "Task " + id + " has already been decided.");
      }
      if (row.status === "expired") {
        throw new TaskError("task_expired", "Task " + id + " expired before it was decided.");
      }
      throw new TaskError("task_already_decided", "Task " + id + " is no longer pending.");
    },

    cancel(id: string): Promise<boolean> {
      return store.cancel(id, new Date());
    },
  };

  // Framework plumbing: the handler's calls join its policy transaction and carry its actor.
  api.bindScope = (scope: PolicyScopedDatabase, next: TaskActorContext): TasksApi =>
    createTasksApi(store.scoped?.(scope) ?? store, next);
  return api;
}

function normalizeTask(input: RequestTaskInput, actor: string | null): NewStoredTask {
  if (typeof input !== "object" || input === null) {
    throw invalid("A task request must be an object.");
  }
  const titleKey = input.titleKey;
  if (
    typeof titleKey !== "string" ||
    titleKey.length === 0 ||
    titleKey.length > MAX_TITLE_KEY_LENGTH ||
    !TITLE_KEY_PATTERN.test(titleKey)
  ) {
    throw invalid("titleKey must be a flat i18n key (letters, digits, dot, dash, underscore).");
  }
  return {
    id: randomUUID(),
    workflowId: null,
    stepIndex: null,
    kind: "approval",
    titleKey,
    titleParams: normalizeTitleParams(input.titleParams),
    payload: input.payload === undefined ? null : serializeTaskData(input.payload),
    requestedBy: actor,
    assignedPermission: normalizePermission(input.assignedPermission),
    expiresAt: normalizeExpiresAt(input.expiresAt),
    createdAt: new Date(),
  };
}

function normalizeTitleParams(value: RequestTaskInput["titleParams"]): TaskJson {
  if (value === undefined) return {};
  const parsed = serializeTaskData(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid("titleParams must be a JSON object.");
  }
  return parsed;
}

function normalizePermission(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PERMISSION_LENGTH ||
    !PERMISSION_PATTERN.test(value)
  ) {
    throw invalid(
      "assignedPermission must be a permission name (letters, digits, colon, dash, underscore).",
    );
  }
  return value;
}

function normalizeExpiresAt(value: string | Date | undefined): Date | null {
  if (value === undefined) return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw invalid("expiresAt is not a valid ISO-8601 instant.");
  }
  return instant;
}

function normalizeComment(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_COMMENT_LENGTH) {
    throw invalid("comment must be a string of at most 1000 characters.");
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeFilters(options: TaskListOptions): TaskListFilters {
  const status = options.status;
  const workflowId = options.workflowId;
  const assignedPermission = options.assignedPermission;
  return {
    ...(status === undefined ? {} : { status }),
    ...(workflowId === undefined ? {} : { workflowId }),
    ...(assignedPermission === undefined ? {} : { assignedPermission }),
    limit: normalizeLimit(options.limit),
  };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1) {
    throw invalid("limit must be a positive integer.");
  }
  return Math.min(value, MAX_LIMIT);
}

function invalid(message: string): TaskError {
  return new TaskError("task_invalid_input", message);
}
