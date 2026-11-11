import { hasPermission, type AuthContext } from "@facilis/auth";
import { guardDatabase, runWithPolicyScope, TableAccessError } from "@facilis/db";
import type { z } from "zod";

import { fail } from "./errors.ts";
import type { FacilisHandlerEvent, FacilisRequestEvent } from "./event.ts";
import { startRequestLogging } from "./route-logging.ts";
import type { AuthorizedHandlerContext } from "./route-context.ts";
import { unavailableJobs } from "./jobs.ts";
import { unavailableTasks } from "./tasks.ts";
import { unavailableWorkflows } from "./workflows.ts";
import { throttleRouteRequest, type RateLimitWindow } from "./rate-limit.ts";
import { parseRequestInput } from "./request-input.ts";
import { isRequestOriginAllowed } from "./request-security.ts";
import { resolveScope } from "./route-scope.ts";
import { unavailableStorage } from "./storage.ts";
import { createElevationContext } from "./sudo.ts";

/**
 * The route security contract (SPEC §7.4, §8.2; contracts §7).
 *
 * Every API route goes through this wrapper: session → permission → Zod validation →
 * policy-scoped DB → handler. It returns a web `Response` for failures and plain data on
 * success, so it stays free of h3/nitro/vite imports and works in any Fetch runtime.
 */

export type { AuthContext };
export type { AuthorizedHandlerContext };

export interface AuthorizedHandlerConfig<B = void, Q = void, P = void, F = void> {
  /** `[]` = public route (no session required); otherwise a session plus one matching permission. */
  permission: string | readonly string[];
  /** JSON request body; mutually exclusive with `form` (SPEC §8.2). */
  body?: z.ZodType<B>;
  /** multipart/form-data fields (D-053); mutually exclusive with `body`. */
  form?: z.ZodType<F>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<P>;
  /**
   * `true` = callable from a page on another origin, without credentials. A permission
   * route is then reached with a Bearer token, never the session cookie (which cannot cross
   * origins); v3a makes this combination legal.
   */
  crossSite?: boolean;
  /**
   * Origin-gate policy for framework protocol endpoints (e.g. the SAML ACS): the protocol
   * performs its own origin validation, so the generic CSRF gate must not refuse its
   * cross-site POST. Defaults to `"enforce"`.
   */
  originCheck?: "enforce" | "skip";
  /** REQUIRED (possibly empty): static metadata extracted by the Nitro AST pass (SPEC §7.4). */
  dbTables: readonly string[];
  /** `"table.column"` references, used by the release diff and entity explorer. */
  dbColumns?: readonly string[];
  /**
   * Per-route fixed-window throttle, keyed by the client address and the route path (D-152).
   * Evaluated by the wrapper before permissions and body parsing, so a brute-force loop cannot
   * reach the PBKDF2 comparison; a deployment that resolves no client address skips it rather
   * than throttling every caller through one shared window.
   */
  rateLimit?: RateLimitWindow;
  /**
   * Explicit exception for `ctx.db.execute(sql)` (D-157): the SQL is not inspectable, so the
   * declaration stays authoritative; without this flag raw execution is refused. Default false.
   */
  rawSql?: boolean;
  description?: string;
}

/** The outer handler the framework returns; it receives the full request context. */
export type AuthorizedHandler = (event: FacilisRequestEvent) => Promise<unknown>;

/**
 * Public routes (`permission: []`) may run anonymously, so their `ctx.auth` is nullable;
 * every privileged form gets the guaranteed non-null `AuthContext` (contracts §4.4).
 */
export type AuthorizedHandlerAuth<Permission extends string | readonly string[]> =
  Permission extends readonly []
    ? AuthContext | null
    : Permission extends readonly [string, ...string[]]
      ? AuthContext
      : Permission extends string
        ? AuthContext
        : AuthContext | null;

function normalizePermissions(permission: string | readonly string[]): readonly string[] {
  return typeof permission === "string" ? [permission] : permission;
}

/**
 * The event a project handler receives: the same req/res objects and a context copy that
 * keeps auth/params plus ONLY the safe facilis fields. The root Drizzle client
 * (`facilis.db`) is captured by the wrapper and never reaches the handler surface (D-099).
 */
function toHandlerEvent(
  event: FacilisRequestEvent,
  facilis: NonNullable<FacilisRequestEvent["context"]["facilis"]>,
): FacilisHandlerEvent {
  const { auth, params } = event.context;
  const defaultTenantId = facilis.defaultTenantId;
  return {
    context: {
      ...(auth === undefined ? {} : { auth }),
      ...(params === undefined ? {} : { params }),
      ...(defaultTenantId === undefined ? {} : { facilis: { defaultTenantId } }),
    },
    req: event.req,
    ...(event.res === undefined ? {} : { res: event.res }),
  };
}

export function defineAuthorizedHandler<
  B = void,
  Q = void,
  P = void,
  const Permission extends string | readonly string[] = string,
  F = void,
>(
  config: AuthorizedHandlerConfig<B, Q, P, F> & { permission: Permission },
  handler: (
    event: FacilisHandlerEvent,
    ctx: AuthorizedHandlerContext<B, Q, P, AuthorizedHandlerAuth<Permission>, F>,
  ) => Promise<unknown> | unknown,
): AuthorizedHandler {
  // One request body has exactly one representation: JSON or multipart, never both.
  if (config.body !== undefined && config.form !== undefined) {
    throw new Error("defineAuthorizedHandler: body and form are mutually exclusive");
  }
  const requiredPermissions = normalizePermissions(config.permission);

  return async (event: FacilisRequestEvent): Promise<unknown> => {
    const auth = event.context.auth ?? null;
    const facilis = event.context.facilis;
    const scope = resolveScope(auth, facilis);
    // D-119: one correlation id and one bound logger per request. Every exit path records
    // exactly one access entry in the finally block below.
    const requestLog = startRequestLogging(event, auth, scope.tenantId);
    let status = 500;
    const respond = (response: Response): Response => {
      status = response.status;
      return response;
    };

    try {
      // CSRF gate: a credentialed request from another origin is refused before anything
      // else runs, and it still records its access entry through the finally below. A
      // protocol endpoint (originCheck: "skip") relies on its own protocol validation.
      const originAllowed = isRequestOriginAllowed({
        method: event.req.method,
        headers: event.req.headers,
        trustedOrigins: event.context.security?.trustedOrigins ?? [],
        crossSite: config.crossSite === true || config.originCheck === "skip",
      });
      if (!originAllowed) return respond(fail("forbidden"));

      // Throttle before permissions and body parsing: every route passes through this wrapper,
      // and a login brute-force loop must be stopped before it reaches the password hash
      // (SEC-04, D-152). The address comes from the middleware's proxy-trust decision; without
      // one there is no honest per-client key, so the route is not globally throttled.
      const rateLimit = config.rateLimit;
      if (rateLimit !== undefined) {
        const denied = throttleRouteRequest(event, rateLimit, facilis?.clientAddress);
        if (denied !== undefined) {
          requestLog.log.audit({
            operation: "http:rate_limit",
            outcome: "failed",
            errorCode: "too_many_requests",
          });
          return respond(denied);
        }
      }

      if (requiredPermissions.length > 0) {
        if (auth === null) return respond(fail("unauthorized"));
        if (!hasPermission(auth, requiredPermissions)) return respond(fail("forbidden"));
      }

      const input = await parseRequestInput(config, event);
      if (!input.ok) return respond(input.response);

      // A route that touches the DB without a booted db cannot be served: fail loudly, not 200.
      if (facilis === undefined) return respond(fail("db_unavailable"));
      // The context middleware attaches the queue once the db booted. A missing runtime (an
      // unexpected boot failure) must not take the whole route down: the fallback fails only
      // the runtime calls, with a code the route can handle.
      const jobs = facilis.jobs ?? unavailableJobs();
      const tasks = facilis.tasks ?? unavailableTasks();
      const workflows = facilis.workflows ?? unavailableWorkflows();
      const storage = facilis.storage ?? unavailableStorage();

      // The raw root client stays here in the wrapper: the handler event exposes only the safe
      // context fields, so the audited elevation wrappers are the sole escalation path.
      const handlerEvent = toHandlerEvent(event, facilis);
      const result = await runWithPolicyScope(facilis.db, scope, async (db) => {
        // Queue calls made by the handler must run in this transaction: opening a second one
        // on the single PGlite connection would deadlock the request (D-107, JOBS §8).
        const requestJobs = jobs.bindScope?.(db) ?? jobs;
        // The decider comes from the session, never from the request body: decide() writes
        // decided_by from this actor (D-135, docs/WORKFLOWS.md §7).
        const requestTasks = tasks.bindScope?.(db, { actor: auth?.userId ?? null }) ?? tasks;
        // Workflow calls join the request transaction for the same single-connection reason;
        // the runner (not the request) performs the state transitions.
        const requestWorkflows = workflows.bindScope?.(db) ?? workflows;
        const rawSql = config.rawSql === true;
        const elevations = createElevationContext({
          event,
          db,
          auth,
          permissions: requiredPermissions,
          dbTables: config.dbTables,
          tenantId: scope.tenantId,
          rawSql,
        });
        // The handler gets the guarded client; elevations keep the unguarded tx (D-157).
        const ctx: AuthorizedHandlerContext<B, Q, P, AuthContext | null, F> = {
          auth,
          body: input.body,
          form: input.form,
          query: input.query,
          params: input.params,
          db: guardDatabase(db, { declared: config.dbTables, allowRawSql: rawSql }),
          sudo: elevations.sudo,
          system: elevations.system,
          jobs: requestJobs,
          tasks: requestTasks,
          workflows: requestWorkflows,
          storage,
          log: requestLog.log,
          requestId: requestLog.requestId,
        };
        // Runtime guarantee: privileged routes have a session, public routes are nullable;
        // this single cast bridges the conditional overload type to the actual value.
        return await handler(
          handlerEvent,
          ctx as AuthorizedHandlerContext<B, Q, P, AuthorizedHandlerAuth<Permission>, F>,
        );
      });
      status = result instanceof Response ? result.status : 200;
      return result;
    } catch (error) {
      if (error instanceof Response) return respond(error);
      // A declaration violation is audited by code, never by relation name (D-157).
      if (error instanceof TableAccessError) {
        requestLog.log.audit({
          operation: "route:table_access",
          outcome: "failed",
          errorCode: error.code,
        });
        requestLog.recordError(error, error.code);
        return respond(fail(error.code));
      }
      // Without a logging runtime (standalone wrapper) keep the server-side trace here.
      if (facilis?.logging === undefined) {
        console.error("facilis: authorized handler failed", error);
      }
      // Never leak internals to clients: codes only, details stay in the server log (D-119).
      requestLog.recordError(error, "internal_error");
      return respond(fail("internal_error"));
    } finally {
      requestLog.finish(status);
    }
  };
}
