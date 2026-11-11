import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb } from "@facilis.dev/db";

import { randomToken, sha256Hex } from "./crypto.ts";
import type { AuthConfig } from "./roles.ts";
import {
  createSession,
  destroySession,
  readBearerToken,
  SESSION_COOKIE_NAME,
  sessionMiddleware,
  validateSession,
  type SessionEvent,
} from "./session.ts";
import { apiClients, apiTokens, roles, sessions, userRoles, users } from "./tables.ts";
import { createAuthTestDb } from "./test-support.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_TENANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// Module scope so the Bearer fixture builder (defined before the suite) can use it too.
let db: FacilisDb;

const config: AuthConfig = {
  permissions: ["todos:read", "todos:write"],
  roles: { admin: ["*"], user: ["todos:read"] },
  defaultRole: "user",
  sessionDurationMs: 1000 * 60 * 60,
};

function eventWithCookie(cookie: string | undefined): SessionEvent {
  const headers = new Headers(cookie === undefined ? {} : { cookie });
  return { context: {}, req: { headers } };
}

function eventWithHeaders(headers: Record<string, string>): SessionEvent {
  return { context: {}, req: { headers: new Headers(headers) } };
}

/** Inserts a fixture row through the privileged test connection (a superuser bypasses RLS). */
async function insertUser(db: FacilisDb, email: string, tenantId: string): Promise<string> {
  const inserted = await db.db
    .insert(users)
    .values({ email, tenantId })
    .returning({ id: users.id });
  const row = inserted[0];
  if (row === undefined) throw new Error(`failed to insert the fixture user ${email}`);
  return row.id;
}

/** Inserts a service user with a client and a live token: the state a Bearer request meets. */
async function insertBearerClient(role: string): Promise<{ userId: string; accessToken: string }> {
  const secret = "fsec_" + randomToken(16);
  const accessToken = "fat_" + randomToken(24);

  const createdUser = await db.db
    .insert(users)
    .values({
      email: "service+" + globalThis.crypto.randomUUID() + "@facilis.invalid",
      tenantId: TENANT_ID,
      passwordHash: null,
      isService: true,
    })
    .returning({ id: users.id });
  const userId = createdUser[0]?.id;
  if (userId === undefined) throw new Error("failed to insert the service user fixture");
  await db.db.insert(userRoles).values({ userId, role });

  const createdClient = await db.db
    .insert(apiClients)
    .values({
      clientId: "fcli_" + randomToken(16),
      secretHash: await sha256Hex(secret),
      name: "session fixture",
      role,
      userId,
    })
    .returning({ id: apiClients.id });
  const clientRowId = createdClient[0]?.id;
  if (clientRowId === undefined) throw new Error("failed to insert the api client fixture");

  await db.db.insert(apiTokens).values({
    tokenHash: await sha256Hex(accessToken),
    clientId: clientRowId,
    userId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { userId, accessToken };
}

describe("session lifecycle", () => {
  let userId: string;

  beforeAll(async () => {
    db = await createAuthTestDb();
    await db.db.insert(roles).values({ name: "admin" });
    userId = await insertUser(db, "admin@example.com", TENANT_ID);
    await db.db.insert(userRoles).values({ userId, role: "admin" });
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates and validates a session with the joined user", async () => {
    const { id, expiresAt } = await createSession(db.db, userId);
    expect(id).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const validated = await validateSession(db.db, id);
    // D-144: the row key is sha256(cookie id); the raw credential never reaches the table.
    const storedKey = await sha256Hex(id);
    expect(validated?.session.id).toBe(storedKey);
    expect(validated?.session.id).not.toBe(id);
    const rawRows = await db.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, id));
    expect(rawRows).toEqual([]);
    expect(validated?.user).toEqual({
      id: userId,
      email: "admin@example.com",
      tenantId: TENANT_ID,
      createdAt: expect.any(Date),
    });
    expect(validated?.user).not.toHaveProperty("passwordHash");
  });

  it("rejects expired sessions", async () => {
    const { id } = await createSession(db.db, userId, { ttlMs: -60_000 });
    await expect(validateSession(db.db, id)).resolves.toBeNull();
  });

  it("rejects unknown session ids", async () => {
    await expect(validateSession(db.db, "not-a-real-session")).resolves.toBeNull();
  });

  it("destroys sessions idempotently", async () => {
    const { id } = await createSession(db.db, userId);
    await destroySession(db.db, id);
    await expect(validateSession(db.db, id)).resolves.toBeNull();
    await expect(destroySession(db.db, id)).resolves.toBeUndefined();
  });

  it("populates event.context.auth from the session cookie", async () => {
    const { id } = await createSession(db.db, userId);
    const event = eventWithCookie(`theme=dark; ${SESSION_COOKIE_NAME}=${id}; other=1`);
    await sessionMiddleware({ db, config, tenantId: TENANT_ID })(event);

    // D-099: the audit trail correlates with the session by hash, never by the raw id.
    const sessionHash = await sha256Hex(id);
    expect(event.context.auth).toEqual({
      userId,
      roles: ["admin"],
      permissions: ["todos:read", "todos:write"],
      sessionHash,
      via: "session",
    });
    expect(sessionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionHash).not.toBe(id);
  });

  it("leaves sessionHash unset for an anonymous request", async () => {
    const event = eventWithCookie(undefined);
    await sessionMiddleware({ db, config, tenantId: TENANT_ID })(event);
    expect(event.context.auth).toBeNull();
  });

  it("sets auth to null when the cookie is absent, empty or unknown", async () => {
    const middleware = sessionMiddleware({ db, config, tenantId: TENANT_ID });

    const missing = eventWithCookie(undefined);
    await middleware(missing);
    expect(missing.context.auth).toBeNull();

    const empty = eventWithCookie(`${SESSION_COOKIE_NAME}=`);
    await middleware(empty);
    expect(empty.context.auth).toBeNull();

    const unknown = eventWithCookie(`${SESSION_COOKIE_NAME}=unknown-session`);
    await middleware(unknown);
    expect(unknown.context.auth).toBeNull();
  });

  it("sets auth to null for an expired cookie session", async () => {
    const { id } = await createSession(db.db, userId, { ttlMs: -1 });
    const event = eventWithCookie(`${SESSION_COOKIE_NAME}=${id}`);
    await sessionMiddleware({ db, config, tenantId: TENANT_ID })(event);
    expect(event.context.auth).toBeNull();
  });

  it("refuses a session whose user belongs to another tenant", async () => {
    const foreignId = await insertUser(db, "other@example.com", OTHER_TENANT_ID);
    const { id } = await createSession(db.db, foreignId);
    const event = eventWithCookie(`${SESSION_COOKIE_NAME}=${id}`);
    await sessionMiddleware({ db, config, tenantId: TENANT_ID })(event);

    // D-040: the deployment tenant is the only scope. The users join is RLS-filtered to
    // TENANT_ID, so validateSession yields null before the explicit comparison; that
    // comparison stays as the second line of defense where RLS does not apply.
    expect(event.context.auth).toBeNull();
  });

  it("hides a foreign tenant's user row inside the deployment policy scope", async () => {
    const foreignId = await insertUser(db, "scoped-other@example.com", OTHER_TENANT_ID);

    const own = await runWithPolicyScope(db, { tenantId: TENANT_ID }, async (tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.id, userId)),
    );
    const foreign = await runWithPolicyScope(db, { tenantId: TENANT_ID }, async (tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.id, foreignId)),
    );

    expect(own).toEqual([{ id: userId }]);
    expect(foreign).toEqual([]);
  });

  it("authenticates a Bearer token and records the auth channel", async () => {
    const { userId: serviceUserId, accessToken } = await insertBearerClient("admin");
    const event = eventWithHeaders({ authorization: "Bearer " + accessToken });
    await sessionMiddleware({ db, config, tenantId: TENANT_ID })(event);

    expect(event.context.auth).toEqual({
      userId: serviceUserId,
      roles: ["admin"],
      permissions: ["todos:read", "todos:write"],
      sessionHash: await sha256Hex(accessToken),
      via: "bearer",
    });
  });

  it("does not fall back to the cookie when a Bearer token is invalid", async () => {
    const { id } = await createSession(db.db, userId);
    await expect(validateSession(db.db, id)).resolves.not.toBeNull();

    const event = eventWithHeaders({
      authorization: "Bearer fat_not-a-real-token",
      cookie: SESSION_COOKIE_NAME + "=" + id,
    });
    await sessionMiddleware({ db, config, tenantId: TENANT_ID })(event);

    // The request chose token auth: an invalid token is anonymous, not a cookie session.
    expect(event.context.auth).toBeNull();
  });

  it("never validates a cookie session for a service user", async () => {
    const { userId: serviceUserId } = await insertBearerClient("admin");
    const sessionId = "service-session-fixture";
    await db.db.insert(sessions).values({
      id: await sha256Hex(sessionId),
      userId: serviceUserId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(validateSession(db.db, sessionId)).resolves.toBeNull();
    await expect(createSession(db.db, serviceUserId)).rejects.toThrow(
      /service accounts cannot log in/,
    );
  });
});

describe("readBearerToken", () => {
  it("accepts a case-insensitive scheme and rejects malformed headers", () => {
    expect(readBearerToken("Bearer token-1")).toBe("token-1");
    expect(readBearerToken("bearer   token-2")).toBe("token-2");
    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken("Basic token-3")).toBeNull();
    expect(readBearerToken("Bearer ")).toBeNull();
  });
});
