/**
 * The route context's audited elevation (D-099): `sudo` for session callers and `system`
 * for anonymous/bootstrap callers such as registration.
 *
 * Both run the callback as facilis_system inside a SAVEPOINT of the request transaction and
 * append the audit entries (started first, fail closed) before any role switch. The route's
 * own RBAC check is unchanged; the elevation is for operations the business rule requires
 * but the caller's permissions/RLS must not allow directly. The two APIs share ONE nesting
 * guard: a sudo/system call can never be nested inside another elevation.
 */

import type { AuthContext } from "@facilis.dev/auth";
import {
  guardDatabase,
  runWithSystemRole,
  TableAccessError,
  writeSudoAudit,
  type PolicyScopedDatabase,
  type SudoAuditEvent,
} from "@facilis.dev/db";

import type { FacilisRequestEvent } from "./event.ts";
import { fail } from "./errors.ts";

/** What a sudo call must say about itself; all three are audited. */
export interface SudoOptions {
  /** Stable operation label, e.g. "order-request:create" (never user input). */
  readonly operation: string;
  /** Why the escalation is needed (never user input; shown in the operator log). */
  readonly reason: string;
  /** Tables written/read; must be a non-empty subset of the route's dbTables. */
  readonly tables: readonly string[];
}

/** The context's sudo: returns exactly what the elevated callback returns. */
export type SudoHandler = <T>(
  options: SudoOptions,
  fn: (systemDb: PolicyScopedDatabase) => Promise<T>,
) => Promise<T>;

/** What a session-less system call must say about itself; the actor is the audit identity. */
export interface SystemOptions {
  /** "system:<job>", e.g. "system:auth" for registration (never user input). */
  readonly actor: `system:${string}`;
  readonly operation: string;
  readonly reason: string;
  /** Tables written/read; must be a non-empty subset of the route's dbTables. */
  readonly tables: readonly string[];
}

/** The context's system elevation for public/bootstrap routes (no session required). */
export type SystemHandler = <T>(
  options: SystemOptions,
  fn: (systemDb: PolicyScopedDatabase) => Promise<T>,
) => Promise<T>;

/** The audited elevation APIs carried together by the handler context. */
export interface AuditedElevationContext {
  readonly sudo: SudoHandler;
  readonly system: SystemHandler;
}

/** Thrown for a malformed or nested elevation call; the route wrapper maps it to internal_error. */
export class SudoValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SudoValidationError";
    this.code = code;
  }
}

export interface CreateElevationContextInput {
  readonly event: FacilisRequestEvent;
  readonly db: PolicyScopedDatabase;
  readonly auth: AuthContext | null;
  /** The route's normalized permissions; the first one is recorded for context. */
  readonly permissions: readonly string[];
  /** The route's declared dbTables; `tables` must be a subset. */
  readonly dbTables: readonly string[];
  /** Deployment tenant, already resolved for the request scope. */
  readonly tenantId: string;
  /** The route's `rawSql` flag; the elevated client inherits the same exception (D-157). */
  readonly rawSql?: boolean;
}

/** Builds the request-scoped sudo/system closures carried by the handler context. */
export function createElevationContext(
  input: CreateElevationContextInput,
): AuditedElevationContext {
  // Shared across both APIs: an elevation inside an elevation is never allowed.
  let active = false;

  const runElevated = async <T>(
    id: string,
    base: Omit<SudoAuditEvent, "event" | "at">,
    fn: (systemDb: PolicyScopedDatabase) => Promise<T>,
  ): Promise<T> => {
    active = true;
    const startedAt = Date.now();
    // The elevated client is guarded by the elevation's own subset, not the route's: access
    // outside `options.tables` fails closed even inside a system role (D-157).
    const observed = new Set<string>();
    const guardedFn = (systemDb: PolicyScopedDatabase): Promise<T> =>
      fn(
        guardDatabase(systemDb, {
          declared: base.tables,
          allowRawSql: input.rawSql === true,
          onRelation: (relation) => observed.add(relation),
        }),
      );
    try {
      // Fail closed: a broken audit sink throws here, before any role switch.
      writeSudoAudit({ ...base, event: "started", at: new Date().toISOString() });
      try {
        const result = await runWithSystemRole(input.db, { sudoId: id }, guardedFn);
        writeSudoAudit({
          ...base,
          event: "succeeded",
          outcome: "succeeded",
          observedTables: [...observed],
          at: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        // Canonical code only: the internal message may contain data and is not audited.
        writeSudoAudit({
          ...base,
          event: "failed",
          outcome: "failed",
          at: new Date().toISOString(),
          errorCode: error instanceof TableAccessError ? error.code : "handler_failed",
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    } finally {
      active = false;
    }
  };

  const assertNotNested = (): void => {
    if (active) {
      throw new SudoValidationError(
        "sudo_nested",
        "A sudo or system elevation cannot run inside another elevation.",
      );
    }
  };

  const sudo: SudoHandler = async <T>(
    options: SudoOptions,
    fn: (systemDb: PolicyScopedDatabase) => Promise<T>,
  ): Promise<T> => {
    // Session-bound escalation: a public route has no session, use system instead.
    if (input.auth === null) throw fail("unauthorized");
    assertNotNested();
    assertSudoOptions(options, input.dbTables);
    const id = globalThis.crypto.randomUUID();
    return runElevated(id, userAuditBase(input, input.auth, options, id), fn);
  };

  const system: SystemHandler = async <T>(
    options: SystemOptions,
    fn: (systemDb: PolicyScopedDatabase) => Promise<T>,
  ): Promise<T> => {
    assertNotNested();
    assertSystemOptions(options, input.dbTables);
    const id = globalThis.crypto.randomUUID();
    return runElevated(id, systemAuditBase(input, options, id), fn);
  };

  return { sudo, system };
}

function assertSudoOptions(options: SudoOptions, dbTables: readonly string[]): void {
  assertElevationOptions(options, dbTables, "sudo");
}

function assertSystemOptions(options: SystemOptions, dbTables: readonly string[]): void {
  if (
    typeof options.actor !== "string" ||
    !options.actor.startsWith("system:") ||
    options.actor.length <= "system:".length
  ) {
    throw new SudoValidationError(
      "system_invalid_actor",
      'actor must be "system:<job>" for a system elevation.',
    );
  }
  assertElevationOptions(options, dbTables, "system");
}

function assertElevationOptions(
  options: {
    readonly operation: string;
    readonly reason: string;
    readonly tables: readonly string[];
  },
  dbTables: readonly string[],
  prefix: "sudo" | "system",
): void {
  if (!isNonEmptyString(options.operation)) {
    throw new SudoValidationError(
      `${prefix}_invalid_operation`,
      "operation must be a non-empty string.",
    );
  }
  if (!isNonEmptyString(options.reason)) {
    throw new SudoValidationError(`${prefix}_invalid_reason`, "reason must be a non-empty string.");
  }
  if (!Array.isArray(options.tables) || options.tables.length === 0) {
    throw new SudoValidationError(`${prefix}_invalid_tables`, "tables must be a non-empty array.");
  }
  const declared = new Set(dbTables);
  for (const table of options.tables) {
    if (typeof table !== "string" || table.length === 0 || !declared.has(table)) {
      throw new SudoValidationError(
        `${prefix}_invalid_tables`,
        `"${String(table)}" is not one of the route's dbTables.`,
      );
    }
  }
}

function userAuditBase(
  input: CreateElevationContextInput,
  auth: AuthContext,
  options: SudoOptions,
  id: string,
): Omit<SudoAuditEvent, "event" | "at"> {
  return {
    id,
    actor: `user:${auth.userId}`,
    actorUserId: auth.userId,
    ...(auth.sessionHash === undefined ? {} : { sessionHash: auth.sessionHash }),
    roles: auth.roles,
    ...commonAuditFields(input, options),
  };
}

function systemAuditBase(
  input: CreateElevationContextInput,
  options: SystemOptions,
  id: string,
): Omit<SudoAuditEvent, "event" | "at"> {
  return {
    id,
    // The system actor is the label itself: no actorUserId and no sessionHash, even when
    // the route happens to have a session (the callback runs as the system, not the user).
    actor: options.actor,
    roles: [],
    ...commonAuditFields(input, options),
  };
}

function commonAuditFields(
  input: CreateElevationContextInput,
  options: {
    readonly operation: string;
    readonly reason: string;
    readonly tables: readonly string[];
  },
): Omit<SudoAuditEvent, "id" | "event" | "at" | "actor" | "actorUserId" | "sessionHash" | "roles"> {
  const url = readUrl(input.event);
  return {
    tenantId: input.tenantId,
    ...(url === null ? {} : { route: url.pathname }),
    method: input.event.req.method ?? "GET",
    ...(input.permissions[0] === undefined ? {} : { permission: input.permissions[0] }),
    ...readRequestId(input.event.req.headers),
    operation: options.operation,
    reason: options.reason,
    tables: [...options.tables],
  };
}

function readUrl(event: FacilisRequestEvent): URL | null {
  const url = event.req.url;
  if (typeof url !== "string") return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function readRequestId(headers: Headers): { requestId?: string } {
  const requestId = headers.get("x-request-id");
  return requestId === null || requestId.length === 0 ? {} : { requestId };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
