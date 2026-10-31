import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FacilisDb } from "@facilis/db";

import type { AuthConfig } from "./roles.ts";
import {
  createSession,
  destroySession,
  SESSION_COOKIE_NAME,
  sessionMiddleware,
  validateSession,
  type SessionEvent,
} from "./session.ts";
import { roles, userRoles, users } from "./tables.ts";
import { createAuthTestDb } from "./test-support.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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

describe("session lifecycle", () => {
  let db: FacilisDb;
  let userId: string;

  beforeAll(async () => {
    db = await createAuthTestDb();
    await db.db.insert(roles).values({ name: "admin" });
    const inserted = await db.db
      .insert(users)
      .values({ email: "admin@example.com", tenantId: TENANT_ID })
      .returning({ id: users.id });
    const row = inserted[0];
    if (row === undefined) throw new Error("failed to insert the fixture user");
    userId = row.id;
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
    expect(validated?.session.id).toBe(id);
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
    await sessionMiddleware({ db: db.db, config, tenantId: TENANT_ID })(event);

    expect(event.context.auth).toEqual({
      userId,
      roles: ["admin"],
      permissions: ["todos:read", "todos:write"],
    });
  });

  it("sets auth to null when the cookie is absent, empty or unknown", async () => {
    const middleware = sessionMiddleware({ db: db.db, config, tenantId: TENANT_ID });

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
    await sessionMiddleware({ db: db.db, config, tenantId: TENANT_ID })(event);
    expect(event.context.auth).toBeNull();
  });

  it("refuses a session whose user belongs to another tenant", async () => {
    const otherTenant = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const inserted = await db.db
      .insert(users)
      .values({ email: "other@example.com", tenantId: otherTenant })
      .returning({ id: users.id });
    const row = inserted[0];
    if (row === undefined) throw new Error("failed to insert the other-tenant user");

    const { id } = await createSession(db.db, row.id);
    const event = eventWithCookie(`${SESSION_COOKIE_NAME}=${id}`);
    await sessionMiddleware({ db: db.db, config, tenantId: TENANT_ID })(event);

    // D-040: the deployment tenant is the only scope; a foreign row is not a usable session.
    expect(event.context.auth).toBeNull();
  });
});
