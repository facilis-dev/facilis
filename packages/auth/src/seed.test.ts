import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyStatements, type FacilisDb } from "@facilis/db";

import type { AuthConfig } from "./roles.ts";
import { registerInitialAdmin, seedFromConfig, seedStatements } from "./seed.ts";
import { rolePermissions, roles, userRoles, users } from "./tables.ts";
import { createAuthTestDb } from "./test-support.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const config: AuthConfig = {
  permissions: ["todos:read", "todos:write"],
  roles: {
    admin: ["*"],
    manager: ["todos:read", "todos:write"],
    user: ["todos:read"],
  },
  defaultRole: "user",
  sessionDurationMs: 1000,
};

describe("seedFromConfig", () => {
  it("is a pure projection of config.auth.roles (wildcards stay literal)", () => {
    expect(seedFromConfig(config)).toEqual([
      { role: "admin", permission: "*" },
      { role: "manager", permission: "todos:read" },
      { role: "manager", permission: "todos:write" },
      { role: "user", permission: "todos:read" },
    ]);
  });

  it("is deterministic and dedupes repeated permission entries", () => {
    const duplicated: AuthConfig = {
      ...config,
      roles: { user: ["todos:read", "todos:read"] },
    };
    expect(seedFromConfig(config)).toEqual(seedFromConfig(config));
    expect(seedFromConfig(duplicated)).toEqual([{ role: "user", permission: "todos:read" }]);
  });
});

describe("seedStatements", () => {
  it("builds idempotent, deterministic SQL for roles and role_permissions", () => {
    const statements = seedStatements(config);
    expect(statements).toEqual(statements.slice());
    expect(statements).toContain(
      "INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING;",
    );
    expect(statements).toContain(
      "INSERT INTO role_permissions (role, permission) VALUES ('manager', 'todos:write') ON CONFLICT DO NOTHING;",
    );
    expect(seedStatements(config)).toEqual(statements);
  });

  it("escapes single quotes instead of concatenating raw values", () => {
    const quoted: AuthConfig = {
      ...config,
      roles: { "weird'role": ["perm'ission"] },
    };
    const statements = seedStatements(quoted);
    expect(statements[0]).toContain("'weird''role'");
    expect(statements[1]).toContain("'perm''ission'");
  });

  it("seeds the database so rows match the config projection", async () => {
    const db = await createAuthTestDb();
    try {
      await applyStatements(db, seedStatements(config));
      await applyStatements(db, seedStatements(config));

      const roleRows = await db.db.select({ name: roles.name }).from(roles).orderBy(roles.name);
      expect(roleRows.map((row) => row.name)).toEqual(["admin", "manager", "user"]);

      const permissionRows = await db.db
        .select({ role: rolePermissions.role, permission: rolePermissions.permission })
        .from(rolePermissions);
      expect(permissionRows).toHaveLength(4);
      expect(permissionRows.map((row) => `${row.role}:${row.permission}`).toSorted()).toEqual([
        "admin:*",
        "manager:todos:read",
        "manager:todos:write",
        "user:todos:read",
      ]);
    } finally {
      await db.close();
    }
  });
});

async function withInitialAdmin(
  value: string | undefined,
  run: () => Promise<void>,
): Promise<void> {
  const previous = process.env.FACILIS_INITIAL_ADMIN;
  if (value === undefined) {
    delete process.env.FACILIS_INITIAL_ADMIN;
  } else {
    process.env.FACILIS_INITIAL_ADMIN = value;
  }
  try {
    await run();
  } finally {
    if (previous === undefined) {
      delete process.env.FACILIS_INITIAL_ADMIN;
    } else {
      process.env.FACILIS_INITIAL_ADMIN = previous;
    }
  }
}

describe("registerInitialAdmin", () => {
  let db: FacilisDb;
  let matchingId: string;
  let otherId: string;

  beforeAll(async () => {
    db = await createAuthTestDb();
    await applyStatements(db, seedStatements(config));
    const inserted = await db.db
      .insert(users)
      .values([
        { email: "founder@example.com", tenantId: TENANT_ID },
        { email: "other@example.com", tenantId: TENANT_ID },
      ])
      .returning({ id: users.id, email: users.email });
    const matching = inserted.find((row) => row.email === "founder@example.com");
    const other = inserted.find((row) => row.email === "other@example.com");
    if (matching === undefined || other === undefined) throw new Error("fixture users missing");
    matchingId = matching.id;
    otherId = other.id;
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  async function rolesOf(userId: string): Promise<string[]> {
    const rows = await db.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));
    return rows.map((row) => row.role);
  }

  it("returns false when FACILIS_INITIAL_ADMIN is unset", async () => {
    await withInitialAdmin(undefined, async () => {
      await expect(registerInitialAdmin(db.db, matchingId)).resolves.toBe(false);
    });
    await expect(rolesOf(matchingId)).resolves.toEqual([]);
  });

  it("grants admin when the email matches and is idempotent", async () => {
    await withInitialAdmin(" FOUNDER@example.com ", async () => {
      await expect(registerInitialAdmin(db.db, matchingId)).resolves.toBe(true);
      await expect(registerInitialAdmin(db.db, matchingId)).resolves.toBe(true);
    });
    await expect(rolesOf(matchingId)).resolves.toEqual(["admin"]);
  });

  it("returns false and grants nothing when the email does not match", async () => {
    await withInitialAdmin("founder@example.com", async () => {
      await expect(registerInitialAdmin(db.db, otherId)).resolves.toBe(false);
    });
    await expect(rolesOf(otherId)).resolves.toEqual([]);
  });

  it("resolves the user by id as well as by email", async () => {
    await withInitialAdmin("founder@example.com", async () => {
      await expect(registerInitialAdmin(db.db, matchingId)).resolves.toBe(true);
    });
    await expect(rolesOf(matchingId)).resolves.toEqual(["admin"]);
  });

  it("returns false for an unknown user", async () => {
    await withInitialAdmin("nobody@example.com", async () => {
      await expect(registerInitialAdmin(db.db, "nobody@example.com")).resolves.toBe(false);
    });
  });
});
