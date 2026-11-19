import { describe, expect, it } from "vitest";

import { seedStatements } from "@facilis.dev/auth";
import { createDb, type SchemaSnapshot, type TableSnapshot, schemaSnapshot } from "@facilis.dev/db";

import * as schema from "./schema.ts";

/**
 * The example ships no DDL: the declaration in db/schema.ts is what the dev boot materializes
 * (D-193), so this test reads the declaration through the same snapshot the release planner
 * and the reconcile use. A missing policy, a lost tenant default or a table the schema forgot
 * to re-export fails here even though there is no migration file to inspect.
 */
const APPLICATION_TABLES = ["todo_files", "todos"] as const;
const RE_EXPORTED_TABLES = [
  "auth_email_verifications",
  "facilis_jobs",
  "role_permissions",
  "roles",
  "sessions",
  "users",
] as const;

function table(snapshot: SchemaSnapshot, name: string): TableSnapshot {
  const found = snapshot.tables.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error("table " + name + " is not declared");
  return found;
}

describe("declared schema", () => {
  it("re-exports the framework tables the routes touch", async () => {
    const db = await createDb({ schema });
    try {
      const snapshot = await schemaSnapshot(db);
      const names = snapshot.tables.map((candidate) => candidate.name);
      expect(names).toEqual(expect.arrayContaining([...APPLICATION_TABLES, ...RE_EXPORTED_TABLES]));
    } finally {
      await db.close();
    }
  });

  it("declares the application tables with RLS and their isolation policies", async () => {
    const db = await createDb({ schema });
    try {
      const snapshot = await schemaSnapshot(db);
      for (const name of APPLICATION_TABLES) {
        const declared = table(snapshot, name);
        expect(declared.rlsEnabled, name).toBe(true);
        const policies = declared.policies.map((policy) => policy.name);
        expect(
          policies.some((policy) => policy.includes("tenant")),
          name,
        ).toBe(true);
      }
      expect(table(snapshot, "todos").scopeColumn).toEqual({ name: "tenant_id", kind: "tenant" });
    } finally {
      await db.close();
    }
  });

  it("keeps the tenant default on the policy scope, not in application code", async () => {
    const db = await createDb({ schema });
    try {
      const tenantId = table(await schemaSnapshot(db), "todos").columns.find(
        (column) => column.name === "tenant_id",
      );
      expect(tenantId?.default).toContain("nullif(");
      expect(tenantId?.default).toContain("app.tenant_id");
    } finally {
      await db.close();
    }
  });

  it("seeds the roles and permissions from the auth config, without authored SQL", () => {
    const statements = seedStatements({
      permissions: ["users:read"],
      roles: { admin: ["*"], user: ["users:read"] },
      defaultRole: "user",
      sessionDurationMs: 1000,
    });
    const sql = statements.join("\n");
    expect(sql).toContain("INSERT INTO roles (name) VALUES ('admin')");
    expect(sql).toContain(
      "INSERT INTO role_permissions (role, permission) VALUES ('user', 'users:read')",
    );
  });
});
