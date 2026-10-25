import { sql } from "drizzle-orm";
import { PgDialect, getTableConfig, pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

/**
 * A15 — drizzle-orm pgTable + pgPolicy + enableRLS round-trip (SPEC §8.3, §8.4.5).
 *
 * Verifies that the migration generator's input (getTableConfig) exposes both the
 * policies and the RLS flag, so @facilis/db can auto-generate
 * ALTER TABLE ... ENABLE ROW LEVEL SECURITY from the schema alone.
 */

const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    ownerId: uuid("owner_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
  },
  () => [
    pgPolicy("documents_tenant_isolation", {
      for: "all",
      using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
      withCheck: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
    }),
    pgPolicy("documents_read", {
      for: "select",
      using: sql`
        current_setting('app.roles', true)::jsonb ? 'admin'
        OR owner_id = current_setting('app.user_id')::uuid
      `,
    }),
  ],
).enableRLS();

describe("A15 — getTableConfig() exposes policies + enableRLS", () => {
  it("returns a non-empty policies array from pgPolicy()", () => {
    const config = getTableConfig(documents);
    expect(Array.isArray(config.policies)).toBe(true);
    expect(config.policies.length).toBe(2);
    expect(config.policies.map((policy) => policy.name)).toEqual([
      "documents_tenant_isolation",
      "documents_read",
    ]);
    const dialect = new PgDialect();
    console.log(
      "[A15] policies:",
      JSON.stringify(
        config.policies.map((policy) => ({
          name: policy.name,
          for: policy.for,
          as: policy.as,
          using: policy.using ? dialect.sqlToQuery(policy.using).sql : undefined,
          withCheck: policy.withCheck ? dialect.sqlToQuery(policy.withCheck).sql : undefined,
        })),
        null,
        1,
      ),
    );
  });

  it("enableRLS is true", () => {
    const config = getTableConfig(documents);
    expect(config.enableRLS).toBe(true);
  });

  it("policy USING clauses reference app GUCs (not Postgres roles)", () => {
    const config = getTableConfig(documents);
    const dialect = new PgDialect();
    const usingSql = config.policies
      .map((policy) => (policy.using ? dialect.sqlToQuery(policy.using).sql : ""))
      .join(" ");
    expect(usingSql).toContain("current_setting('app.roles', true)");
    expect(usingSql).toContain("current_setting('app.tenant_id')");
    expect(usingSql).not.toMatch(/\bTO\b/);
  });
});