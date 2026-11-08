import { getTableConfig, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { facilisFiles, fileLinks } from "./files.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope } from "./policy.ts";
import { ownerIsolationPolicy, policyCreateSql, tenantIsolationPolicy } from "./rls.ts";

const TENANT_T = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_U = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const FILE_A = "33333333-3333-3333-3333-333333333333";
const FILE_B = "44444444-4444-4444-4444-444444444444";
const DOC_A = "55555555-5555-5555-5555-555555555555";
const DOC_B = "66666666-6666-6666-6666-666666666666";
const FILE_C = "77777777-7777-7777-7777-777777777777";

// A minimal parent table: the generated link table must inherit exactly these policies.
const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    ownerId: uuid("owner_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
  },
  () => [tenantIsolationPolicy("tenant_id"), ownerIsolationPolicy("owner_id")],
).enableRLS();

const documentFiles = fileLinks(documents, { table: "documents_files", column: "document_id" });

describe("file schema helpers", () => {
  it("ships facilis_files with tenant RLS", () => {
    const config = getTableConfig(facilisFiles);
    expect(config.name).toBe("facilis_files");
    expect(config.enableRLS).toBe(true);
    const policies = config.policies.map((policy) => policy.name);
    expect(policies).toContain("tenant_isolation");
    // The restrictive policy needs a permissive gate or facilis_app cannot insert a row.
    expect(policies).toContain("facilis_files_tenant_access");
  });

  it("generates a link table with two cascading FKs and the inherited policy", () => {
    const config = getTableConfig(documentFiles);
    expect(config.name).toBe("documents_files");
    expect(config.enableRLS).toBe(true);
    expect(config.foreignKeys).toHaveLength(2);
    expect(config.foreignKeys.every((fk) => fk.onDelete === "cascade")).toBe(true);
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "document_id",
      "file_id",
      "tenant_id",
      "created_at",
    ]);
    const policies = config.policies.map((policy) => policy.name);
    expect(policies).toContain("tenant_isolation");
    expect(policies).toContain("parent_access");
  });

  it("renders the parent access policy as an EXISTS over the parent", () => {
    const policy = getTableConfig(documentFiles).policies.find(
      (entry) => entry.name === "parent_access",
    );
    expect(policy).toBeDefined();
    const sql = policyCreateSql("documents_files", policy!);
    expect(sql).toMatch(/EXISTS/i);
    expect(sql).toContain('"documents"."id"');
    expect(sql).toContain('"documents_files"."document_id"');
  });

  it("refuses a parent without a single-column primary key", () => {
    const composite = pgTable("composite", { a: uuid("a").notNull(), b: uuid("b").notNull() });
    // Drizzle only records a primary key when declared, so this is the error path too.
    expect(() => fileLinks(composite, { table: "composite_files" })).toThrow(
      /exactly one primary-key column/,
    );
  });
});

describe("file link RLS inheritance", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb();
    const documentPolicies = getTableConfig(documents).policies.map((policy) =>
      policyCreateSql("documents", policy),
    );
    const filePolicies = getTableConfig(facilisFiles).policies.map((policy) =>
      policyCreateSql("facilis_files", policy),
    );
    const linkPolicies = getTableConfig(documentFiles).policies.map((policy) =>
      policyCreateSql("documents_files", policy),
    );

    await applyStatements(db, [
      "CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, owner_id uuid NOT NULL, tenant_id uuid NOT NULL)",
      "CREATE TABLE facilis_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hash text NOT NULL, name text NOT NULL, mime text NOT NULL, size bigint NOT NULL, tenant_id uuid NOT NULL, owner_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
      "CREATE TABLE documents_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE, file_id uuid NOT NULL REFERENCES facilis_files(id) ON DELETE CASCADE, tenant_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
      `INSERT INTO documents (id, title, owner_id, tenant_id) VALUES
        ('${DOC_A}', 'a-doc', '${USER_A}', '${TENANT_T}'),
        ('${DOC_B}', 'b-doc', '${USER_B}', '${TENANT_T}')`,
      `INSERT INTO facilis_files (id, hash, name, mime, size, tenant_id, owner_id) VALUES
        ('${FILE_A}', 'hash-a', 'a.txt', 'text/plain', 3, '${TENANT_T}', '${USER_A}'),
        ('${FILE_B}', 'hash-b', 'b.txt', 'text/plain', 3, '${TENANT_T}', '${USER_B}')`,
      `INSERT INTO documents_files (document_id, file_id, tenant_id) VALUES
        ('${DOC_A}', '${FILE_A}', '${TENANT_T}'),
        ('${DOC_B}', '${FILE_B}', '${TENANT_T}')`,
      "ALTER TABLE documents ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE facilis_files ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE documents_files ENABLE ROW LEVEL SECURITY",
      ...documentPolicies,
      ...filePolicies,
      ...linkPolicies,
    ]);
    await ensureAppRole(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("lets the scoped tenant insert and read its own file metadata", async () => {
    const created = await runWithPolicyScope(
      db,
      { tenantId: TENANT_T, userId: USER_A, roles: [] },
      async (tx) => {
        const [row] = await tx
          .insert(facilisFiles)
          .values({
            id: FILE_C,
            hash: "hash-c",
            name: "c.txt",
            mime: "text/plain",
            size: 3,
            tenantId: TENANT_T,
            ownerId: USER_A,
          })
          .returning({ id: facilisFiles.id });
        return row;
      },
    );
    expect(created?.id).toBe(FILE_C);

    const visible = await runWithPolicyScope(
      db,
      { tenantId: TENANT_T, userId: USER_A, roles: [] },
      async (tx) => tx.select({ id: facilisFiles.id }).from(facilisFiles).orderBy(facilisFiles.id),
    );
    expect(visible.map((row) => row.id)).toContain(FILE_C);
  });

  it("hides file metadata of another tenant", async () => {
    const visible = await runWithPolicyScope(
      db,
      { tenantId: TENANT_U, userId: USER_A, roles: [] },
      async (tx) => tx.select({ id: facilisFiles.id }).from(facilisFiles),
    );
    expect(visible).toEqual([]);
  });

  it("shows a link only when the caller can read its parent", async () => {
    const visible = await runWithPolicyScope(
      db,
      { tenantId: TENANT_T, userId: USER_A, roles: [] },
      async (tx) => {
        const rows = await tx
          .select({ documentId: documentFiles.parentId })
          .from(documentFiles)
          .orderBy(documentFiles.parentId);
        return rows.map((row) => row.documentId);
      },
    );
    expect(visible).toEqual([DOC_A]);
  });

  it("hides every link of another tenant", async () => {
    const visible = await runWithPolicyScope(
      db,
      { tenantId: TENANT_U, userId: USER_A, roles: [] },
      async (tx) => tx.select({ id: documentFiles.id }).from(documentFiles),
    );
    expect(visible).toEqual([]);
  });

  it("refuses to link a file to a parent the caller cannot read", async () => {
    const failure = await runWithPolicyScope(
      db,
      { tenantId: TENANT_T, userId: USER_A, roles: [] },
      async (tx) => {
        await tx.insert(documentFiles).values({
          parentId: DOC_B,
          fileId: FILE_A,
          tenantId: TENANT_T,
        });
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).not.toBeNull();
    // Drizzle wraps the driver error; the Postgres code is 42501 ("new row violates
    // row-level security policy") and lives on the cause.
    const cause = (failure as { cause?: { code?: string; message?: string } }).cause;
    expect(cause?.code ?? cause?.message ?? String(failure)).toMatch(/42501|row-level security/i);
  });
});
