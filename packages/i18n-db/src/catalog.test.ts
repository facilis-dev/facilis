import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb, type PolicyScopedDatabase } from "@facilis.dev/db";

import {
  catalogQuery,
  loadCatalog,
  loadCatalogs,
  parseCatalogLocales,
  saveCatalog,
} from "./catalog.ts";
import { i18nMessages } from "./messages.ts";
import { createI18nTestDb } from "./test-support.ts";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TENANT_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("i18n_messages", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createI18nTestDb();
    // Seeded as the superuser harness; every read/write below runs through RLS as facilis_app.
    await db.db.insert(i18nMessages).values([
      { tenantId: TENANT_A, locale: "en", key: "greeting", value: "Hello" },
      { tenantId: TENANT_A, locale: "it", key: "greeting", value: "Ciao" },
      { tenantId: TENANT_B, locale: "en", key: "greeting", value: "Hey" },
      { tenantId: TENANT_B, locale: "en", key: "only_b", value: "B only" },
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  function inTenant<T>(tenantId: string, fn: (tx: PolicyScopedDatabase) => Promise<T>): Promise<T> {
    return runWithPolicyScope(db, { tenantId }, fn);
  }

  describe("hand-written DDL", () => {
    it("matches the Drizzle schema column for column", async () => {
      const result = await db.db.execute(sql`
        select column_name, data_type, is_nullable, column_default
        from information_schema.columns
        where table_name = 'i18n_messages'
        order by ordinal_position`);
      const rows = result.rows as {
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }[];
      expect(rows.map((row) => row.column_name)).toEqual([
        "tenant_id",
        "locale",
        "key",
        "value",
        "updated_at",
      ]);
      expect(rows.map((row) => row.data_type)).toEqual([
        "uuid",
        "text",
        "text",
        "text",
        "timestamp with time zone",
      ]);
      expect(rows.map((row) => row.is_nullable)).toEqual(["NO", "NO", "NO", "NO", "YES"]);
      expect(rows[0]?.column_default).toContain("current_setting");
      expect(rows[4]?.column_default).toContain("now()");
    });

    it("keys rows by (tenant_id, locale, key) in that order", async () => {
      const result = await db.db.execute(sql`
        select a.attname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid = 'i18n_messages'::regclass and c.contype = 'p'
        order by array_position(c.conkey, a.attnum)`);
      expect(result.rows.map((row) => row.attname)).toEqual(["tenant_id", "locale", "key"]);
    });

    it("enables RLS with the generated policies", async () => {
      const rls = await db.db.execute(sql`
        select relrowsecurity from pg_class where relname = 'i18n_messages'`);
      expect(rls.rows[0]?.relrowsecurity).toBe(true);

      const policies = await db.db.execute(sql`
        select polname, polpermissive, pg_get_expr(polqual, polrelid) as using_sql
        from pg_policy
        where polrelid = 'i18n_messages'::regclass
        order by polname`);
      const byName = Object.fromEntries(policies.rows.map((row) => [row.polname as string, row]));
      expect(Object.keys(byName).toSorted()).toEqual([
        "i18n_messages_tenant_access",
        "tenant_isolation",
      ]);
      expect(byName.tenant_isolation?.polpermissive).toBe(false);
      expect(byName.i18n_messages_tenant_access?.polpermissive).toBe(true);
      // Both policies read the same GUC the scope helper sets.
      expect(byName.tenant_isolation?.using_sql).toContain("app.tenant_id");
    });
  });

  describe("reads under RLS", () => {
    it("isolates one locale's catalogue by tenant", async () => {
      await expect(inTenant(TENANT_A, (tx) => loadCatalog(tx, "en"))).resolves.toEqual({
        greeting: "Hello",
      });
      await expect(inTenant(TENANT_B, (tx) => loadCatalog(tx, "en"))).resolves.toEqual({
        greeting: "Hey",
        only_b: "B only",
      });
      await expect(inTenant(TENANT_A, (tx) => loadCatalog(tx, "it"))).resolves.toEqual({
        greeting: "Ciao",
      });
    });

    it("loads several locales and keeps empty catalogues in the response", async () => {
      await expect(
        inTenant(TENANT_A, (tx) => loadCatalogs(tx, ["it", "en", "fr"])),
      ).resolves.toEqual({
        it: { greeting: "Ciao" },
        en: { greeting: "Hello" },
        fr: {},
      });
    });

    it("returns no rows without a tenant scope", async () => {
      await expect(runWithPolicyScope(db, {}, (tx) => loadCatalog(tx, "en"))).resolves.toEqual({});
    });
  });

  describe("saveCatalog", () => {
    it("upserts every key and overwrites the value on a re-save", async () => {
      await inTenant(TENANT_C, (tx) =>
        saveCatalog(tx, "en", { greeting: "Hello", farewell: "Bye" }),
      );
      await expect(inTenant(TENANT_C, (tx) => loadCatalog(tx, "en"))).resolves.toEqual({
        farewell: "Bye",
        greeting: "Hello",
      });

      await inTenant(TENANT_C, (tx) => saveCatalog(tx, "en", { greeting: "Hi" }));
      await expect(inTenant(TENANT_C, (tx) => loadCatalog(tx, "en"))).resolves.toEqual({
        farewell: "Bye",
        greeting: "Hi",
      });

      const rows = await db.db
        .select({ key: i18nMessages.key })
        .from(i18nMessages)
        .where(and(eq(i18nMessages.tenantId, TENANT_C), eq(i18nMessages.locale, "en")));
      // One row per composite key: the update replaced the existing row, no duplicate.
      expect(rows.map((row) => row.key)).toEqual(["farewell", "greeting"]);
    });

    it("refreshes updated_at when an existing key changes", async () => {
      await db.db.execute(sql`
        update i18n_messages set updated_at = now() - interval '1 day'
        where tenant_id = ${TENANT_C} and locale = 'en' and key = 'greeting'`);

      await inTenant(TENANT_C, (tx) => saveCatalog(tx, "en", { greeting: "Ciao" }));

      const rows = await db.db
        .select({ value: i18nMessages.value, updatedAt: i18nMessages.updatedAt })
        .from(i18nMessages)
        .where(
          and(
            eq(i18nMessages.tenantId, TENANT_C),
            eq(i18nMessages.locale, "en"),
            eq(i18nMessages.key, "greeting"),
          ),
        );
      expect(rows[0]?.value).toBe("Ciao");
      expect(rows[0]?.updatedAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it("writes nothing for an empty catalogue", async () => {
      await inTenant(TENANT_C, (tx) => saveCatalog(tx, "it", {}));
      const rows = await db.db
        .select({ key: i18nMessages.key })
        .from(i18nMessages)
        .where(and(eq(i18nMessages.tenantId, TENANT_C), eq(i18nMessages.locale, "it")));
      expect(rows).toEqual([]);
    });
  });
});

describe("catalogQuery and parseCatalogLocales", () => {
  it("parses a comma list, trimming and deduping", () => {
    expect(parseCatalogLocales(" en, it ,en,")).toEqual(["en", "it"]);
  });

  it("defaults a blank list to en", () => {
    expect(parseCatalogLocales("")).toEqual(["en"]);
    expect(parseCatalogLocales("   ")).toEqual(["en"]);
  });

  it("accepts the default through the zod query schema", () => {
    expect(catalogQuery.parse({})).toEqual({ locales: "en" });
    expect(catalogQuery.parse({ locales: "it,en" })).toEqual({ locales: "it,en" });
  });
});
