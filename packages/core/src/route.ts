import { hasPermission, type AuthContext } from "@facilis/auth";
import { runWithPolicyScope, type PolicyScope, type PolicyScopedDatabase } from "@facilis/db";
import type { z } from "zod";

import { fail } from "./errors.ts";
import type { FacilisHandlerEvent, FacilisRequestEvent } from "./event.ts";
import type { FacilisLogger } from "./logging.ts";
import { startRequestLogging } from "./route-logging.ts";
import { unavailableJobs, type JobsApi } from "./jobs.ts";
import { parseRequestInput } from "./request-input.ts";
import { isRequestOriginAllowed } from "./request-security.ts";
import { unavailableStorage, type StorageApi } from "./storage.ts";
import { createElevationContext, type SudoHandler, type SystemHandler } from "./sudo.ts";
import { DEFAULT_TENANT_ID } from "./tenancy.ts";

/**
 * The route security contract (SPEC §7.4, §8.2; contracts §7).
 *
 * Every API route goes through this wrapper: session → permission → Zod validation →
 * policy-scoped DB → handler. It returns a web `Response` for failures and plain data on
 * success, so it stays free of h3/nitro/vite imports and works in any Fetch runtime.
 */

export type { AuthContext };

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
  description?: string;
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
   * Server-only binary storage (D-053, SPEC §5.10): store bytes, build signed download URLs
   * and verify their tokens. Access control stays in the app routes.
   */
  storage: StorageApi;
  /** Request logger (D-119): debug/info/warn/error lines plus app audit events. */
  log: FacilisLogger;
  /** Correlation id of this request, the same one its access/error entries carry. */
  requestId: string;
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

/** The request scope: tenant is always resolved, unlike the general PolicyScope contract. */
interface ResolvedScope extends PolicyScope {
  readonly tenantId: string;
}

function resolveScope(
  auth: AuthContext | null,
  facilis: { defaultTenantId?: string } | undefined,
): ResolvedScope {
  // The tenant is the deployment's, never the session's (D-040): this is the only value RLS
  // will accept, so a session cannot widen or change the scope. Anonymous routes
  // (registration/login) get the same value, which is what makes the tenant column default
  // and the RLS WITH CHECK agree. The framework constant is the fallback so an app that
  // forgets FACILIS_TENANT_ID behaves like the Nitro middleware.
  const tenantId = facilis?.defaultTenantId ?? DEFAULT_TENANT_ID;
  // Permissions travel in app.permissions for permission views (D-098); they are the
  // session's expanded set, never the route's required list.
  const permissions = auth?.permissions ?? [];
  return auth === null
    ? { tenantId, permissions }
    : { tenantId, permissions, userId: auth.userId, roles: auth.roles };
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
      // the job calls, with a code the route can handle.
      const jobs = facilis.jobs ?? unavailableJobs();
      const storage = facilis.storage ?? unavailableStorage();

      // The raw root client stays here in the wrapper: the handler event exposes only the safe
      // context fields, so the audited elevation wrappers are the sole escalation path.
      const handlerEvent = toHandlerEvent(event, facilis);
      const result = await runWithPolicyScope(facilis.db, scope, async (db) => {
        // Queue calls made by the handler must run in this transaction: opening a second one
        // on the single PGlite connection would deadlock the request (D-107, JOBS §8).
        const requestJobs = jobs.bindScope?.(db) ?? jobs;
        const elevations = createElevationContext({
          event,
          db,
          auth,
          permissions: requiredPermissions,
          dbTables: config.dbTables,
          tenantId: scope.tenantId,
        });
        const ctx: AuthorizedHandlerContext<B, Q, P, AuthContext | null, F> = {
          auth,
          body: input.body,
          form: input.form,
          query: input.query,
          params: input.params,
          db,
          sudo: elevations.sudo,
          system: elevations.system,
          jobs: requestJobs,
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
