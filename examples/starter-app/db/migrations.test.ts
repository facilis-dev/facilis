import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * The template ships committed migrations (CI never runs drizzle-kit), so this test applies
 * the same `*.sql` set the Nitro runtime applies at boot — every file in db/migrations, in
 * name order — to an in-memory PGlite and inspects the resulting catalog. It fails if the
 * DDL drifts from the auth tables re-exported by db/schema.ts.
 */
const MIGRATION_SOURCES = import.meta.glob("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const MIGRATION_NAMES = Object.keys(MIGRATION_SOURCES).toSorted();

const TEST_TIMEOUT_MS = 60_000;

let db: PGlite;

interface ColumnRow {
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: string;
  readonly column_default: string | null;
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

beforeAll(async () => {
  db = new PGlite();
  for (const name of MIGRATION_NAMES) {
    const source = MIGRATION_SOURCES[name];
    if (source === undefined) throw new Error(`missing migration source: ${name}`);
    // no-await-in-loop: the files must apply in name order, so they cannot run in parallel.
    // eslint-disable-next-line no-await-in-loop
    await db.exec(source);
  }
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await db.close();
});

async function columns(table: string): Promise<ColumnRow[]> {
  const result = await db.query<ColumnRow>(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [table],
  );
  return result.rows;
}

/**
 * Shape (names, types, nullability), not the exact default text: a default is asserted where it
 * matters below, and PGlite rewrites default expressions.
 */
function shape(rows: readonly ColumnRow[]) {
  return rows.map(({ column_name, data_type, is_nullable }) => ({
    column_name,
    data_type,
    is_nullable,
  }));
}

describe("starter app migrations", () => {
  it("finds every migration, in name order, ending with the role seed", () => {
    expect(MIGRATION_NAMES.length).toBeGreaterThan(0);
    expect(MIGRATION_NAMES[0]).toMatch(/\/0000_auth_tables\.sql$/);
    expect(MIGRATION_NAMES.at(-1)).toMatch(/\/0001_seed_roles\.sql$/);
  });

  it("creates the auth tables with the columns db/schema.ts re-exports", async () => {
    expect(shape(await columns("users"))).toEqual([
      { column_name: "created_at", data_type: "timestamp without time zone", is_nullable: "YES" },
      { column_name: "email", data_type: "text", is_nullable: "NO" },
      {
        column_name: "email_verified_at",
        data_type: "timestamp without time zone",
        is_nullable: "YES",
      },
      { column_name: "id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "is_service", data_type: "boolean", is_nullable: "NO" },
      { column_name: "password_hash", data_type: "text", is_nullable: "YES" },
      { column_name: "tenant_id", data_type: "uuid", is_nullable: "NO" },
    ]);

    expect(shape(await columns("sessions"))).toEqual([
      { column_name: "expires_at", data_type: "timestamp without time zone", is_nullable: "NO" },
      { column_name: "id", data_type: "text", is_nullable: "NO" },
      { column_name: "user_id", data_type: "uuid", is_nullable: "NO" },
    ]);

    expect(shape(await columns("user_roles"))).toEqual([
      { column_name: "assigned_at", data_type: "timestamp without time zone", is_nullable: "YES" },
      { column_name: "assigned_by", data_type: "uuid", is_nullable: "YES" },
      { column_name: "role", data_type: "text", is_nullable: "NO" },
      { column_name: "user_id", data_type: "uuid", is_nullable: "NO" },
    ]);
  });

  it("applies the defaults the auth tables rely on (D-040)", async () => {
    const users = new Map((await columns("users")).map((row) => [row.column_name, row]));
    expect(users.get("id")?.column_default).toContain("gen_random_uuid");
    expect(users.get("is_service")?.column_default).toContain("false");
    expect(users.get("created_at")?.column_default).toContain("now");
    // Filled from the deployment scope by the policy GUC, never named by a route.
    expect(users.get("tenant_id")?.column_default).toContain("app.tenant_id");
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

  it("enables RLS only on the app-reachable tables (D-136)", async () => {
    const result = await db.query<RlsRow>(
      `select relname, relrowsecurity from pg_class
        where relname in ('users', 'sessions', 'user_roles', 'roles', 'role_permissions')
          and relkind = 'r'
        order by relname`,
    );
    expect(result.rows).toEqual([
      { relname: "role_permissions", relrowsecurity: false },
      { relname: "roles", relrowsecurity: false },
      { relname: "sessions", relrowsecurity: true },
      { relname: "user_roles", relrowsecurity: true },
      { relname: "users", relrowsecurity: true },
    ]);
  });

  it("installs the tenant and parent-user policies", async () => {
    const result = await db.query<PolicyRow>(
      `select policyname, tablename, permissive, cmd
         from pg_policies
        where schemaname = 'public' and tablename in ('users', 'sessions', 'user_roles')
        order by tablename, policyname`,
    );
    expect(result.rows).toEqual([
      {
        policyname: "sessions_user_access",
        tablename: "sessions",
        permissive: "PERMISSIVE",
        cmd: "ALL",
      },
      {
        policyname: "user_roles_user_access",
        tablename: "user_roles",
        permissive: "PERMISSIVE",
        cmd: "ALL",
      },
      { policyname: "tenant_isolation", tablename: "users", permissive: "RESTRICTIVE", cmd: "ALL" },
      {
        policyname: "users_tenant_access",
        tablename: "users",
        permissive: "PERMISSIVE",
        cmd: "ALL",
      },
    ]);
  });

  it("references the parent user and role rows", async () => {
    const result = await db.query<ForeignKeyRow>(
      `select conname,
              conrelid::regclass::text as table_name,
              confrelid::regclass::text as target_table
         from pg_constraint
        where contype = 'f'
          and conrelid in (
            'public.users'::regclass,
            'public.sessions'::regclass,
            'public.user_roles'::regclass,
            'public.role_permissions'::regclass
          )
        order by conname`,
    );
    expect(result.rows).toEqual([
      {
        conname: "role_permissions_role_roles_name_fk",
        table_name: "role_permissions",
        target_table: "roles",
      },
      { conname: "sessions_user_id_users_id_fk", table_name: "sessions", target_table: "users" },
      { conname: "user_roles_role_roles_name_fk", table_name: "user_roles", target_table: "roles" },
      {
        conname: "user_roles_user_id_users_id_fk",
        table_name: "user_roles",
        target_table: "users",
      },
    ]);
  });

  it("seeds the roles declared in facilis.config.ts, and only those", async () => {
    const roles = await db.query<{ name: string }>("select name from roles order by name");
    expect(roles.rows.map((row) => row.name)).toEqual(["admin", "user"]);

    const permissions = await db.query<{ role: string; permission: string }>(
      "select role, permission from role_permissions order by role, permission",
    );
    expect(permissions.rows).toEqual([{ role: "admin", permission: "*" }]);
  });
});
