import { getTableConfig } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb, type PolicyScope } from "@facilis/db";

import { users } from "./tables.ts";
import { createAuthTestDb } from "./test-support.ts";

const TENANT_T = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_U = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("users RLS", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createAuthTestDb();
    await db.db.insert(users).values([
      { email: "t-one@example.com", tenantId: TENANT_T },
      { email: "t-two@example.com", tenantId: TENANT_T },
      { email: "u-one@example.com", tenantId: TENANT_U },
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  async function visibleEmails(scope: PolicyScope): Promise<string[]> {
    return runWithPolicyScope(db, scope, async (tx) => {
      const rows = await tx.select({ email: users.email }).from(users).orderBy(users.email);
      return rows.map((row) => row.email);
    });
  }

  it("declares tenant RLS on the users table", () => {
    const config = getTableConfig(users);
    expect(config.enableRLS).toBe(true);
    expect(config.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "users_tenant_access",
    ]);
    expect(config.policies[0]?.as).toBe("restrictive");
    expect(config.policies[1]?.as ?? "permissive").toBe("permissive");
  });

  it("isolates users by tenant under the non-superuser app role", async () => {
    await expect(visibleEmails({ tenantId: TENANT_T })).resolves.toEqual([
      "t-one@example.com",
      "t-two@example.com",
    ]);
    await expect(visibleEmails({ tenantId: TENANT_U })).resolves.toEqual(["u-one@example.com"]);
  });

  it("returns no rows without a tenant scope", async () => {
    await expect(visibleEmails({})).resolves.toEqual([]);
  });

  it("queries as facilis_app, proving superuser RLS bypass is not in play", async () => {
    const identity = await runWithPolicyScope(db, { tenantId: TENANT_T }, async (tx) => {
      const result = await tx.execute(sql`select current_user as role`);
      return result.rows[0];
    });
    expect(identity).toEqual({ role: "facilis_app" });
  });
});
