import type { AuthContext } from "@facilis.dev/auth";
import type { PolicyScopedDatabase } from "@facilis.dev/db";

import type { JobsApi } from "./jobs.ts";
import type { FacilisRuntimeConfig } from "./runtime-config/schema.ts";
import type { FacilisLogger } from "./logging.ts";
import type { StorageApi } from "./storage.ts";
import type { SudoHandler, SystemHandler } from "./sudo.ts";
import type { TasksApi } from "./tasks.ts";
import type { WorkflowsApi } from "./workflows.ts";

/**
 * The handler context contract, kept in its own module so the wrapper stays under the
 * 300-line production limit (AGENTS.md) while the security-critical request flow in
 * route.ts stays the single place that assembles it.
 */

/** Why a handler needs the unguarded client; recorded in the audit stream (D-226). */
export interface RawDbOptions {
  readonly reason: string;
}

/**
 * The declared escape from the table guard. It returns the request transaction with the
 * policy role applied, never the root client: a declared route can run dynamic SQL, but it
 * still runs with the app role's privileges.
 */
export type RawDbAccessor = (options: RawDbOptions) => PolicyScopedDatabase;

/** The context a declared raw route receives: no parsed input, no guarded db. */
export interface RawRouteContext<A extends AuthContext | null = AuthContext | null> {
  auth: A;
  params: Record<string, string>;
  /** The declared, audited unguarded client (D-226 decision 3). */
  rawDb: RawDbAccessor;
  sudo: SudoHandler;
  system: SystemHandler;
  log: FacilisLogger;
  requestId: string;
}

export interface AuthorizedHandlerContext<
  B = void,
  Q = void,
  P = void,
  A extends AuthContext | null = AuthContext,
  F = void,
> {
  auth: A;
  body: B;
  /** Validated multipart fields when the route declared a `form` schema. */
  form: F;
  query: Q;
  params: P;
  /** Pre-scoped client: never the raw database (SPEC §7.4). */
  db: PolicyScopedDatabase;
  /**
   * Declared escape from the table guard (D-226): the same policy-scoped transaction, with
   * no relation check. Every call carries a reason and is audited; a raw route has only
   * this accessor, never `db`.
   */
  rawDb: RawDbAccessor;
  /**
   * Audited elevation for operations the route's permission/RLS cannot allow directly
   * (D-099). Runs the callback as facilis_system inside the request transaction, logging
   * started/succeeded/failed; the route's own permission check still applies.
   */
  sudo: SudoHandler;
  /**
   * Audited system elevation for public/bootstrap routes that have no session (D-099):
   * registration/bootstrap writes run as the named `system:<job>` actor, never as the
   * anonymous caller. Same savepoint/role/audit flow as sudo, same nesting guard.
   */
  system: SystemHandler;
  /**
   * Server-only background-job queue (D-107): enqueue/schedule a job, read the queue or a
   * job by id, force it to stop. Jobs always execute in a system context; this API has no
   * HTTP surface of its own.
   */
  jobs: JobsApi;
  /**
   * Server-only manual-task surface (D-135): request a durable human task, list the inbox
   * and record the decision. The task row is the continuation flag; the caller never writes
   * the workflow state itself.
   */
  tasks: TasksApi;
  /**
   * Server-only workflow surface (D-135): start a named job/approval chain, read its state
   * and cancel it. The runtime owns the workflow row; a route never writes it directly.
   */
  workflows: WorkflowsApi;
  /**
   * Server-only binary storage (D-053, SPEC §5.10): store bytes, build signed download URLs
   * and verify their tokens. Access control stays in the app routes.
   */
  storage: StorageApi;
  /** Request logger (D-119): debug/info/warn/error lines plus app audit events. */
  log: FacilisLogger;
  /** Resolved once at boot (D-224), frozen; the only environment surface a route has. */
  runtime: FacilisRuntimeConfig;
  /** Correlation id of this request, the same one its access/error entries carry. */
  requestId: string;
}
