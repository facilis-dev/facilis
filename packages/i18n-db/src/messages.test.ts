import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { policyCreateSql, tenantDefaultSql } from "@facilis/db";

import { i18nMessages } from "./messages.ts";

const dialect = new PgDialect();
const config = getTableConfig(i18nMessages);
const columns = Object.fromEntries(config.columns.map((column) => [column.name, column]));

function policyNamed(name: string) {
  const policy = config.policies.find((entry) => entry.name === name);
  if (policy === undefined) throw new Error(`i18n_messages is missing the ${name} policy`);
  return policy;
}

describe("i18nMessages schema", () => {
  it("declares the tenant-scoped message columns", () => {
    expect(config.name).toBe("i18n_messages");
    expect(Object.keys(columns)).toEqual(["tenant_id", "locale", "key", "value", "updated_at"]);

    expect(columns.tenant_id?.getSQLType()).toBe("uuid");
    expect(columns.tenant_id?.notNull).toBe(true);
    expect(columns.tenant_id?.hasDefault).toBe(true);

    for (const name of ["locale", "key", "value"]) {
      expect(columns[name]?.getSQLType()).toBe("text");
      expect(columns[name]?.notNull).toBe(true);
    }

    expect(columns.updated_at?.getSQLType()).toBe("timestamp with time zone");
    expect(columns.updated_at?.hasDefault).toBe(true);
  });

  it("takes the tenant from the policy-scope GUC, not from the app", () => {
    const columnDefault = dialect.sqlToQuery(columns.tenant_id?.default as SQL).sql;
    expect(columnDefault).toBe(dialect.sqlToQuery(tenantDefaultSql()).sql);
  });

  it("keys rows by tenant, locale and key", () => {
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "locale",
      "key",
    ]);
  });

  it("enables RLS with restrictive tenant isolation and the permissive scope gate", () => {
    expect(config.enableRLS).toBe(true);
    expect(config.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "i18n_messages_tenant_access",
    ]);

    const isolation = policyNamed("tenant_isolation");
    expect(isolation.as).toBe("restrictive");
    expect(isolation.for).toBe("all");
    expect(policyCreateSql("i18n_messages", isolation)).toContain(" AS RESTRICTIVE ");
    expect(policyCreateSql("i18n_messages", isolation)).toContain(
      "nullif(current_setting('app.tenant_id', true), '')::uuid",
    );

    // Restrictive policies only narrow what a permissive policy allows, so the table needs
    // exactly one permissive gate or every scoped query would return no rows.
    const access = policyNamed("i18n_messages_tenant_access");
    expect(access.as ?? "permissive").toBe("permissive");
    expect(policyCreateSql("i18n_messages", access)).toContain(
      "nullif(current_setting('app.tenant_id', true), '') IS NOT NULL",
    );
  });
});
