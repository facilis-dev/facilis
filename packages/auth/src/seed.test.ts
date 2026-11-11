import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyStatements, type FacilisDb } from "@facilis.dev/db";

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

interface InitialAdminEnv {
  readonly email?: string;
  readonly token?: string;
}

/** Runs with exactly the given bootstrap env; both variables are restored afterwards. */
async function withInitialAdmin(env: InitialAdminEnv, run: () => Promise<void>): Promise<void> {
  const previousEmail = process.env.FACILIS_INITIAL_ADMIN;
  const previousToken = process.env.FACILIS_INITIAL_ADMIN_TOKEN;
  setEnv("FACILIS_INITIAL_ADMIN", env.email);
  setEnv("FACILIS_INITIAL_ADMIN_TOKEN", env.token);
  try {
    await run();
  } finally {
    setEnv("FACILIS_INITIAL_ADMIN", previousEmail);
    setEnv("FACILIS_INITIAL_ADMIN_TOKEN", previousToken);
  }
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
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

  it("fails closed when FACILIS_INITIAL_ADMIN is unset", async () => {
    await withInitialAdmin({ token: "bootstrap-secret" }, async () => {
      await expect(registerInitialAdmin(db.db, matchingId, "bootstrap-secret")).resolves.toBe(
        false,
      );
    });
    await expect(rolesOf(matchingId)).resolves.toEqual([]);
  });

  it("fails closed when the bootstrap token is unset, so the email alone is not a credential", async () => {
    await withInitialAdmin({ email: "founder@example.com" }, async () => {
      await expect(registerInitialAdmin(db.db, matchingId, "bootstrap-secret")).resolves.toBe(
        false,
      );
      await expect(registerInitialAdmin(db.db, matchingId)).resolves.toBe(false);
    });
    await expect(rolesOf(matchingId)).resolves.toEqual([]);
  });

  it("refuses a wrong bootstrap token without touching the role", async () => {
    await withInitialAdmin(
      { email: "founder@example.com", token: "bootstrap-secret" },
      async () => {
        await expect(registerInitialAdmin(db.db, matchingId, "guess")).resolves.toBe(false);
        await expect(registerInitialAdmin(db.db, matchingId)).resolves.toBe(false);
      },
    );
    await expect(rolesOf(matchingId)).resolves.toEqual([]);
  });

  it("does not promote a case variant of the configured email without the token", async () => {
    await withInitialAdmin({ email: "founder@example.com" }, async () => {
      await expect(registerInitialAdmin(db.db, "FOUNDER@example.com")).resolves.toBe(false);
    });
    await expect(rolesOf(matchingId)).resolves.toEqual([]);
  });

  it("grants admin once when both email and token match, resolved by email", async () => {
    await withInitialAdmin(
      { email: " FOUNDER@example.com ", token: "bootstrap-secret" },
      async () => {
        await expect(
          registerInitialAdmin(db.db, "Founder@Example.com", "bootstrap-secret"),
        ).resolves.toBe(true);
        // One-time: the promotion cannot be replayed even while the env stays configured.
        await expect(
          registerInitialAdmin(db.db, "founder@example.com", "bootstrap-secret"),
        ).resolves.toBe(false);
      },
    );
    await expect(rolesOf(matchingId)).resolves.toEqual(["admin"]);
  });

  it("does not promote another user after the admin exists, even with a valid token", async () => {
    await withInitialAdmin({ email: "other@example.com", token: "bootstrap-secret" }, async () => {
      await expect(registerInitialAdmin(db.db, otherId, "bootstrap-secret")).resolves.toBe(false);
    });
    await expect(rolesOf(otherId)).resolves.toEqual([]);
  });

  it("returns false for an unknown user and an email mismatch", async () => {
    await withInitialAdmin({ email: "nobody@example.com", token: "bootstrap-secret" }, async () => {
      await expect(
        registerInitialAdmin(db.db, "nobody@example.com", "bootstrap-secret"),
      ).resolves.toBe(false);
    });
    await expect(rolesOf(otherId)).resolves.toEqual([]);
  });
});
