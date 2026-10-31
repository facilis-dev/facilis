import { hasPermission, type AuthContext } from "@facilis/auth";
import { runWithPolicyScope, type PolicyScope, type PolicyScopedDatabase } from "@facilis/db";
import type { z } from "zod";

import { fail, invalidInput } from "./errors.ts";
import type { FacilisRequestEvent } from "./event.ts";
import { DEFAULT_TENANT_ID } from "./tenancy.ts";

/**
 * The route security contract (SPEC §7.4, §8.2; contracts §7).
 *
 * Every API route goes through this wrapper: session → permission → Zod validation →
 * policy-scoped DB → handler. It returns a web `Response` for failures and plain data on
 * success, so it stays free of h3/nitro/vite imports and works in any Fetch runtime.
 */

export type { AuthContext };

export interface AuthorizedHandlerConfig<B = void, Q = void, P = void> {
  /** `[]` = public route (no session required); otherwise a session plus one matching permission. */
  permission: string | readonly string[];
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<P>;
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
> {
  auth: A;
  body: B;
  query: Q;
  params: P;
  /** Pre-scoped client: never the raw database (SPEC §7.4). */
  db: PolicyScopedDatabase;
}

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

type PartSuccess<T> = { readonly ok: true; readonly value: T };
type PartFailure = { readonly ok: false; readonly response: Response };
type PartOutcome<T> = PartSuccess<T> | PartFailure;
type ParseOutcome<B, Q, P> =
  { readonly ok: true; readonly body: B; readonly query: Q; readonly params: P } | PartFailure;

const JSON_BODY_REQUIRED_DETAILS = { formErrors: ["This route requires a JSON request body"] };
const JSON_BODY_INVALID_DETAILS = { formErrors: ["Request body must be valid JSON"] };

function normalizePermissions(permission: string | readonly string[]): readonly string[] {
  return typeof permission === "string" ? [permission] : permission;
}

function readQuery(event: FacilisRequestEvent): Record<string, string> {
  const url = event.req.url;
  if (typeof url !== "string") return {};
  try {
    // Repeated keys collapse to the last value; query schemas coerce the flat record.
    return Object.fromEntries(new URL(url).searchParams);
  } catch {
    return {};
  }
}

function parsePart<T>(schema: z.ZodType<T> | undefined, value: unknown): PartOutcome<T> {
  if (schema === undefined) {
    // An absent schema means "part not provided": the context field is typed void.
    return { ok: true, value: undefined as unknown as T };
  }
  const result = schema.safeParse(value);
  if (!result.success) return { ok: false, response: invalidInput(result.error) };
  return { ok: true, value: result.data };
}

async function parseBody<T>(
  schema: z.ZodType<T> | undefined,
  event: FacilisRequestEvent,
): Promise<PartOutcome<T>> {
  if (schema === undefined) return { ok: true, value: undefined as unknown as T };

  const json = event.req.json;
  if (typeof json !== "function") {
    return { ok: false, response: fail("invalid_input", JSON_BODY_REQUIRED_DETAILS) };
  }
  let raw: unknown;
  try {
    raw = await json.call(event.req);
  } catch {
    return { ok: false, response: fail("invalid_input", JSON_BODY_INVALID_DETAILS) };
  }
  return parsePart(schema, raw);
}

async function parseRequestInput<B, Q, P>(
  config: AuthorizedHandlerConfig<B, Q, P>,
  event: FacilisRequestEvent,
): Promise<ParseOutcome<B, Q, P>> {
  const params = parsePart(config.params, event.context.params ?? {});
  if (!params.ok) return params;

  const query = parsePart(config.query, readQuery(event));
  if (!query.ok) return query;

  const body = await parseBody(config.body, event);
  if (!body.ok) return body;

  return { ok: true, body: body.value, query: query.value, params: params.value };
}

function resolveScope(
  auth: AuthContext | null,
  facilis: { defaultTenantId?: string } | undefined,
): PolicyScope {
  // The tenant is the deployment's, never the session's (D-040): this is the only value RLS
  // will accept, so a session cannot widen or change the scope. Anonymous routes
  // (registration/login) get the same value, which is what makes the tenant column default
  // and the RLS WITH CHECK agree. The framework constant is the fallback so an app that
  // forgets FACILIS_TENANT_ID behaves like the Nitro middleware.
  const tenantId = facilis?.defaultTenantId ?? DEFAULT_TENANT_ID;
  return auth === null ? { tenantId } : { tenantId, userId: auth.userId, roles: auth.roles };
}

export function defineAuthorizedHandler<
  B = void,
  Q = void,
  P = void,
  const Permission extends string | readonly string[] = string,
>(
  config: AuthorizedHandlerConfig<B, Q, P> & { permission: Permission },
  handler: (
    event: FacilisRequestEvent,
    ctx: AuthorizedHandlerContext<B, Q, P, AuthorizedHandlerAuth<Permission>>,
  ) => Promise<unknown> | unknown,
): AuthorizedHandler {
  const requiredPermissions = normalizePermissions(config.permission);

  return async (event: FacilisRequestEvent): Promise<unknown> => {
    const auth = event.context.auth ?? null;

    if (requiredPermissions.length > 0) {
      if (auth === null) return fail("unauthorized");
      if (!hasPermission(auth, requiredPermissions)) return fail("forbidden");
    }

    const input = await parseRequestInput(config, event);
    if (!input.ok) return input.response;

    const facilis = event.context.facilis;
    // A route that touches the DB without a booted db cannot be served: fail loudly, not 200.
    if (facilis === undefined) return fail("db_unavailable");

    const scope = resolveScope(auth, facilis);
    try {
      return await runWithPolicyScope(facilis.db, scope, async (db) => {
        const ctx: AuthorizedHandlerContext<B, Q, P, AuthContext | null> = {
          auth,
          body: input.body,
          query: input.query,
          params: input.params,
          db,
        };
        // Runtime guarantee: privileged routes have a session, public routes are nullable;
        // this single cast bridges the conditional overload type to the actual value.
        return await handler(
          event,
          ctx as AuthorizedHandlerContext<B, Q, P, AuthorizedHandlerAuth<Permission>>,
        );
      });
    } catch (error) {
      if (error instanceof Response) return error;
      // Never leak internals to clients: codes only, details stay in the server log.
      console.error("facilis: authorized handler failed", error);
      return fail("internal_error");
    }
  };
}
