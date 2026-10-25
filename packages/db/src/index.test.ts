import { describe, expect, it } from "vitest";
import { getTableConfig, pgTable, uuid } from "drizzle-orm/pg-core";

import * as dbPackage from "./index.ts";
import { rlsForTable } from "./rls.ts";

describe("@facilis/db public surface", () => {
  it("exports every Phase 1 contract member", () => {
    expect(typeof dbPackage.createDb).toBe("function");
    expect(typeof dbPackage.runWithPolicyScope).toBe("function");
    expect(typeof dbPackage.ensureAppRole).toBe("function");
    expect(typeof dbPackage.applyStatements).toBe("function");
    expect(typeof dbPackage.applyMigrations).toBe("function");
    expect(typeof dbPackage.schemaSnapshot).toBe("function");
    expect(typeof dbPackage.tenantIsolationPolicy).toBe("function");
    expect(typeof dbPackage.ownerIsolationPolicy).toBe("function");
    expect(typeof dbPackage.rolePolicy).toBe("function");
    expect(typeof dbPackage.rlsForTable).toBe("function");
    expect(dbPackage.withRls).toBe(dbPackage.rlsForTable);
  });

  it("exposes the app role name and default scope columns", () => {
    expect(dbPackage.APP_ROLE).toBe("facilis_app");
    expect(dbPackage.DEFAULT_TENANT_COLUMNS).toContain("tenant_id");
    expect(dbPackage.DEFAULT_OWNER_COLUMNS).toContain("owner_id");
  });

  it("attaches policy extras to a pgTable definition", () => {
    const extras = rlsForTable({ tenantColumn: "tenant_id" });
    const table = pgTable(
      "probe",
      { tenantId: uuid("tenant_id").notNull() },
      () => extras.policies,
    );
    const config = getTableConfig(table);
    expect(config.policies.map((policy) => policy.name)).toEqual(["tenant_isolation"]);
    expect(extras.enableRLS).toBe(true);
  });

  it("exposes a typed not-implemented error code", () => {
    const error = new dbPackage.DriverNotImplementedError("postgres");
    expect(error.code).toBe("driver_not_implemented");
    expect(error.message).toContain("postgres");
  });
});
