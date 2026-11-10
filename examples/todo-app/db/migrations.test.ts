import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * The example app ships hand-written migrations (drizzle-kit is not part of CI), so this test
 * applies the same `*.sql` set the Nitro runtime applies at boot — every file in
 * db/migrations, in name order — to an in-memory PGlite and inspects the resulting catalog.
 * It fails if the hand-written DDL drifts from packages/auth/src/tables.ts.
 */
const MIGRATION_SOURCES = import.meta.glob("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const MIGRATION_NAMES = Object.keys(MIGRATION_SOURCES).sort();

const TEST_TIMEOUT_MS = 60_000;

let db: PGlite;

interface ColumnRow {
  readonly data_type: string;
  readonly is_nullable: string;
  readonly column_default: string | null;
}

interface TableRow {
  readonly table_name: string;
}

interface RlsRow {
  readonly relname: string;
  readonly relrowsecurity: boolean;
}

interface PolicyRow {
  readonly policyname: string;
  readonly tablename: string;
  readonly permissive: string;
  readonly cmd: string;
}

interface ForeignKeyRow {
  readonly conname: string;
  readonly table_name: string;
  readonly target_table: string;
}

interface UniqueRow {
  readonly conname: string;
}

beforeAll(async () => {
  db = new PGlite();
  for (const name of MIGRATION_NAMES) {
    const source = MIGRATION_SOURCES[name];
    if (source === undefined) throw new Error(`missing migration source: ${name}`);
    await db.exec(source);
  }
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await db.close();
});

describe("example app migrations", () => {
  it("finds every migration, with 0008 last in name order", () => {
    expect(MIGRATION_NAMES.length).toBeGreaterThan(0);
    expect(MIGRATION_NAMES.at(-1)).toMatch(/\/0008_users_email_lower\.sql$/);
  });

  it("enforces case-insensitive email identity with a unique lower(email) index (D-150)", async () => {
    const result = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'users_email_lower_idx'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.indexdef.toLowerCase()).toContain("lower(email)");
    expect(result.rows[0]?.indexdef.toLowerCase()).toContain("unique");
  });

  it("replaces the queue's tenant-only policy with permission-gated policies (D-145)", async () => {
    const result = await db.query<PolicyRow>(
      `select policyname, tablename, permissive, cmd
         from pg_policies
        where schemaname = 'public' and tablename = 'facilis_jobs'
        order by policyname`,
    );
    expect(result.rows).toEqual([
      {
        policyname: "facilis_jobs_delete",
        tablename: "facilis_jobs",
        permissive: "PERMISSIVE",
        cmd: "DELETE",
      },
      {
        policyname: "facilis_jobs_insert",
        tablename: "facilis_jobs",
        permissive: "PERMISSIVE",
        cmd: "INSERT",
      },
      {
        policyname: "facilis_jobs_read",
        tablename: "facilis_jobs",
        permissive: "PERMISSIVE",
        cmd: "SELECT",
      },
      {
        policyname: "facilis_jobs_update",
        tablename: "facilis_jobs",
        permissive: "PERMISSIVE",
        cmd: "UPDATE",
      },
      {
        policyname: "tenant_isolation",
        tablename: "facilis_jobs",
        permissive: "RESTRICTIVE",
        cmd: "ALL",
      },
    ]);
  });

  it("adds users.is_service as a non-null boolean defaulting to false", async () => {
    const result = await db.query<ColumnRow>(
      `select data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'users' and column_name = 'is_service'`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      data_type: "boolean",
      is_nullable: "NO",
    });
    expect(result.rows[0]?.column_default).toContain("false");
  });

  it("creates the api_clients and api_tokens tables", async () => {
    const result = await db.query<TableRow>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public' and table_name in ('api_clients', 'api_tokens')
        order by table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(["api_clients", "api_tokens"]);
  });

  it("enables row level security on both tables", async () => {
    const result = await db.query<RlsRow>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('api_clients', 'api_tokens')
        order by c.relname`,
    );

    expect(result.rows).toEqual([
      { relname: "api_clients", relrowsecurity: true },
      { relname: "api_tokens", relrowsecurity: true },
    ]);
  });

  it("installs the parent-user policies on both tables", async () => {
    const result = await db.query<PolicyRow>(
      `select policyname, tablename, permissive, cmd
         from pg_policies
        where schemaname = 'public' and tablename in ('api_clients', 'api_tokens')
        order by policyname`,
    );

    expect(result.rows).toEqual([
      {
        policyname: "api_clients_user_access",
        tablename: "api_clients",
        permissive: "PERMISSIVE",
        cmd: "ALL",
      },
      {
        policyname: "api_tokens_user_access",
        tablename: "api_tokens",
        permissive: "PERMISSIVE",
        cmd: "ALL",
      },
    ]);
  });

  it("references the parent users and client rows", async () => {
    const result = await db.query<ForeignKeyRow>(
      `select conname,
              conrelid::regclass::text as table_name,
              confrelid::regclass::text as target_table
         from pg_constraint
        where contype = 'f'
          and conrelid in ('public.api_clients'::regclass, 'public.api_tokens'::regclass)
        order by conname`,
    );

    expect(result.rows).toEqual([
      {
        conname: "api_clients_user_id_users_id_fk",
        table_name: "api_clients",
        target_table: "users",
      },
      {
        conname: "api_tokens_client_id_api_clients_id_fk",
        table_name: "api_tokens",
        target_table: "api_clients",
      },
      {
        conname: "api_tokens_user_id_users_id_fk",
        table_name: "api_tokens",
        target_table: "users",
      },
    ]);
  });

  it("keeps client ids and token hashes unique", async () => {
    const result = await db.query<UniqueRow>(
      `select conname
         from pg_constraint
        where contype = 'u'
          and conrelid in ('public.api_clients'::regclass, 'public.api_tokens'::regclass)
        order by conname`,
    );

    expect(result.rows.map((row) => row.conname)).toEqual([
      "api_clients_client_id_unique",
      "api_tokens_token_hash_unique",
    ]);
  });
});
