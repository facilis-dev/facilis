import { eq } from "drizzle-orm";

import { runWithPolicyScope, type FacilisDb, type PolicyScopedDatabase } from "@facilis/db";

import { randomToken, sha256Hex } from "./crypto.ts";
import { expandRoles, type AuthConfig } from "./roles.ts";
import { sessions, userRoles, users, type AuthUser, type SessionRow } from "./tables.ts";

/** Cookie name fixed by contract §4.4; HttpOnly/Path=/SameSite=Lax/Secure-in-prod. */
export const SESSION_COOKIE_NAME = "facilis_session";

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface CreateSessionOptions {
  readonly ttlMs?: number;
}

export interface ValidatedSession {
  readonly user: AuthUser;
  readonly session: SessionRow;
}

/** Creates an opaque session row; callers set the cookie themselves (route blueprint). */
export async function createSession(
  db: PolicyScopedDatabase,
  userId: string,
  options: CreateSessionOptions = {},
): Promise<{ id: string; expiresAt: Date }> {
  const id = randomToken(32);
  const expiresAt = new Date(Date.now() + (options.ttlMs ?? DEFAULT_SESSION_TTL_MS));
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

/**
 * Joins the session to its user; expired or unknown sessions yield null.
 *
 * Callers pass a policy-scoped client (`runWithPolicyScope`) with app.tenant_id set: users
 * carries tenant RLS, so an unscoped read as the non-superuser facilis_app role cannot see
 * the joined user row at all.
 */
export async function validateSession(
  db: PolicyScopedDatabase,
  sessionId: string,
): Promise<ValidatedSession | null> {
  const rows = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        email: users.email,
        tenantId: users.tenantId,
        createdAt: users.createdAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const found = rows[0];
  if (found === undefined) return null;
  if (found.session.expiresAt.getTime() <= Date.now()) return null;
  return { user: found.user, session: found.session };
}

/** Deletes a session row; deleting an unknown id is a no-op. */
export async function destroySession(db: PolicyScopedDatabase, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Structural event type: an H3/Nitro event satisfies it without importing h3 here.
 * `context` stays a plain record because h3's H3EventContext exposes unknown values
 * through an index signature; middleware writes `context.auth` (AuthContext | null).
 */
export type SessionEventContext = Record<string, unknown>;

export interface SessionEvent {
  context: SessionEventContext;
  req: { headers: { get(name: string): string | null } };
}

export interface SessionMiddlewareDeps {
  /** Database the middleware scopes; the runtime may connect as the facilis_app role. */
  readonly db: FacilisDb;
  readonly config: AuthConfig;
  /** The deployment's tenant; a session whose user row names another one is rejected (D-040). */
  readonly tenantId: string;
}

/**
 * Builds the `facilis-session` middleware handler. It reads the session cookie, then
 * validates the session and loads app roles inside ONE deployment-tenant policy scope
 * (`runWithPolicyScope`), expands the roles from config (SPEC §8.4.4) and sets
 * `context.auth`.
 *
 * The scope matters: production connects as the non-superuser facilis_app role, so `users`
 * is RLS-filtered and an unscoped read cannot see any user row. Running both queries in the
 * tenant's transaction is what makes sessions work without a privileged client (D-068).
 */
export function sessionMiddleware(
  deps: SessionMiddlewareDeps,
): (event: SessionEvent) => Promise<void> {
  return async (event) => {
    const sessionId = readCookie(event.req.headers.get("cookie"), SESSION_COOKIE_NAME);
    if (sessionId === null) {
      event.context.auth = null;
      return;
    }

    const auth = await runWithPolicyScope(deps.db, { tenantId: deps.tenantId }, async (tx) => {
      const found = await validateSession(tx, sessionId);
      if (found === null) return null;
      // The tenant is the deployment's, never the session's (D-040). RLS already hides another
      // tenant's user row from the lookup; this explicit check keeps the rule even on a
      // connection where RLS would not apply (defense in depth).
      if (found.user.tenantId !== deps.tenantId) return null;

      const roles = await loadUserRoles(tx, found.user.id);
      return {
        userId: found.user.id,
        roles,
        permissions: expandRoles(roles, deps.config),
      };
    });
    // Only a valid session gets a hash: the audit trail correlates requests with a session
    // without ever storing the cookie value (D-099).
    event.context.auth =
      auth === null ? null : { ...auth, sessionHash: await sha256Hex(sessionId) };
  };
}

async function loadUserRoles(db: PolicyScopedDatabase, userId: string): Promise<string[]> {
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows.map((row) => row.role);
}

function readCookie(header: string | null, name: string): string | null {
  if (header === null || header.length === 0) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length === 0 ? null : value;
  }
  return null;
}
