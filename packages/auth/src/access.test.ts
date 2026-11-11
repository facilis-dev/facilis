import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb } from "@facilis.dev/db";

import { createSession, validateSession } from "./session.ts";
import { rolePermissions, roles, sessions, userRoles, users } from "./tables.ts";
import { createAuthTestDb } from "./test-support.ts";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/**
 * D-136: a table is reachable either through RLS or only through the system identity.
 * `sessions`/`user_roles` inherit the parent user's visibility; `roles`/`role_permissions`
 * are system-only and the app role must be denied outright.
 */
describe("auth tables: RLS-scoped or system-only", () => {
  let db: FacilisDb;
  let userA: string;
  let userB: string;
  let sessionA: string;

  beforeAll(async () => {
    db = await createAuthTestDb();
    // The privileged roots writes: roles/role_permissions/system-only rows are never written
    // by a route, and the fixtures are the bootstrap path.
    await db.db.insert(roles).values([{ name: "admin" }]);
    userA = await insertUser("a@example.com", TENANT_A);
    userB = await insertUser("b@example.com", TENANT_B);
    await db.db.insert(userRoles).values([
      { userId: userA, role: "admin" },
      { userId: userB, role: "admin" },
    ]);
    sessionA = (await createSession(db.db, userA)).id;
    await createSession(db.db, userB);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("declares RLS on sessions and user_roles", () => {
    for (const [table, policy] of [
      [sessions, "sessions_user_access"],
      [userRoles, "user_roles_user_access"],
    ] as const) {
      const config = getTableConfig(table);
      expect(config.enableRLS).toBe(true);
      expect(config.policies.map((entry) => entry.name)).toEqual([policy]);
    }
  });

  it("shows a session only in its own tenant scope", async () => {
    const inA = await runWithPolicyScope(db, { tenantId: TENANT_A }, (tx) =>
      validateSession(tx, sessionA),
    );
    expect(inA?.user.id).toBe(userA);
    const inB = await runWithPolicyScope(db, { tenantId: TENANT_B }, (tx) =>
      validateSession(tx, sessionA),
    );
    expect(inB).toBeNull();
    const unscoped = await runWithPolicyScope(db, {}, (tx) => validateSession(tx, sessionA));
    expect(unscoped).toBeNull();
  });

  it("shows a role assignment only in its own tenant scope", async () => {
    const inA = await runWithPolicyScope(db, { tenantId: TENANT_A }, (tx) =>
      tx.select({ userId: userRoles.userId }).from(userRoles),
    );
    expect(inA.map((row) => row.userId)).toEqual([userA]);
    const inB = await runWithPolicyScope(db, { tenantId: TENANT_B }, (tx) =>
      tx.select({ userId: userRoles.userId }).from(userRoles),
    );
    expect(inB.map((row) => row.userId)).toEqual([userB]);
  });

  it("refuses an app-role write that crosses the tenant through the parent", async () => {
    await expectPermissionDenied(
      runWithPolicyScope(db, { tenantId: TENANT_A }, (tx) => createSession(tx, userB)),
    );
    await expectPermissionDenied(
      runWithPolicyScope(db, { tenantId: TENANT_A }, async (tx) => {
        await tx.insert(userRoles).values({ userId: userB, role: "admin" });
      }),
    );
  });

  it("keeps roles and role_permissions system-only", async () => {
    await expectPermissionDenied(
      runWithPolicyScope(db, { tenantId: TENANT_A }, (tx) => tx.select().from(roles)),
    );
    await expectPermissionDenied(
      runWithPolicyScope(db, { tenantId: TENANT_A }, (tx) => tx.select().from(rolePermissions)),
    );
    // The privileged path still reads them (seed/migration code runs as the owner).
    const rootRows = await db.db.select({ name: roles.name }).from(roles);
    expect(rootRows).toEqual([{ name: "admin" }]);
  });

  async function insertUser(email: string, tenantId: string): Promise<string> {
    const inserted = await db.db
      .insert(users)
      .values({ email, tenantId, passwordHash: null })
      .returning({ id: users.id });
    const row = inserted[0];
    if (row === undefined) throw new Error("failed to insert the fixture user");
    return row.id;
  }
});

/** Drizzle wraps pg errors, so the privilege message lives on the cause chain. */
async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).not.toBeNull();
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join(" | ")).toMatch(/permission denied|row-level security/i);
}
