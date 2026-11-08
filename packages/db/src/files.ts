// File metadata and per-entity attachment links (D-053).
//
// The bytes live in content-addressed storage (`@facilis/storage`), never in Postgres:
// `facilis_files` is the metadata row (content hash, name, mime, size, owner), and a
// generated link table attaches a file to one row of an application table. Bytes are
// deduplicated by hash, so two uploads of the same content share one blob.
//
// The link table is generated rather than polymorphic on purpose: a real foreign key per
// entity keeps referential integrity (`ON DELETE CASCADE`), lets the manifest/OpenAPI name
// the relation, and inherits the parent's RLS through an EXISTS policy evaluated with the
// parent's own policies. A `(entity_table, entity_id)` pair would have none of that.
import { sql } from "drizzle-orm";
import {
  bigint,
  getTableConfig,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  type PgColumn,
  type PgTable,
} from "drizzle-orm/pg-core";

import { tenantIsolationPolicy } from "./rls.ts";
import { tenantColumn } from "./tenant-column.ts";

/**
 * One uploaded file's metadata. The uniqueness of `hash` is a storage concern (the local
 * driver and S3 both address by content), so the same bytes may have several rows with
 * different names/mime types.
 *
 * Access to the bytes is decided by the routes that issue signed URLs, not by a per-row
 * owner policy here: tenant isolation is the structural boundary, and a file attached to
 * an entity is readable by whoever can read that entity. `owner_id` is the audit/issuer
 * identity (and the owner check the upload route uses).
 */
export const facilisFiles = pgTable(
  "facilis_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hash: text("hash").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    tenantId: tenantColumn(),
    ownerId: uuid("owner_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    tenantIsolationPolicy(),
    // A RESTRICTIVE policy only narrows what a permissive policy already allows; with no
    // permissive policy Postgres denies every row (D-008). Uploads insert a metadata row
    // as facilis_app, so the scoped tenant needs this gate — like auth users and
    // facilis_jobs. The RESTRICTIVE tenant policy still confines visible rows to the tenant.
    pgPolicy("facilis_files_tenant_access", {
      for: "all",
      using: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
      withCheck: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
    }),
  ],
).enableRLS();

export type FacilisFile = typeof facilisFiles.$inferSelect;
export type NewFacilisFile = typeof facilisFiles.$inferInsert;

export interface FileLinksOptions {
  /** Name of the generated link table, e.g. "todo_files". */
  readonly table: string;
  /** FK column name in the link table, e.g. "todo_id". Defaults to "parent_id". */
  readonly column?: string;
}

/**
 * Build the link table that lets one application table contain files.
 *
 * ```ts
 * export const todoFiles = fileLinks(todos, { table: "todo_files", column: "todo_id" });
 * ```
 *
 * The parent needs a single-column primary key (uuid recommended: the FK is a uuid). The
 * generated table carries a restrictive tenant policy and a permissive `parent_access`
 * policy: `EXISTS (SELECT 1 FROM parent WHERE parent.pk = link.parent_id)`. Postgres
 * evaluates that subquery under the caller's role, so the parent table's policies decide
 * visibility — the link inherits the parent's access rules instead of restating them.
 */
export function fileLinks<TParent extends PgTable>(parent: TParent, options: FileLinksOptions) {
  const config = getTableConfig(parent);
  // A column-level `.primaryKey()` lives on the column, not in `primaryKeys` (which only
  // records table-level composite keys), so collect both and require exactly one.
  const parentKey = config.columns.find((column) => column.primary);
  if (parentKey === undefined) {
    throw new Error(
      `fileLinks(${config.name}): the parent table needs exactly one primary-key column`,
    );
  }
  const parentColumn: PgColumn = parentKey;
  const parentTable: PgTable = parent;

  return pgTable(
    options.table,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      parentId: uuid(options.column ?? "parent_id")
        .notNull()
        .references(() => parentColumn, { onDelete: "cascade" }),
      fileId: uuid("file_id")
        .notNull()
        .references(() => facilisFiles.id, { onDelete: "cascade" }),
      tenantId: tenantColumn(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (link) => [
      tenantIsolationPolicy(),
      pgPolicy("parent_access", {
        for: "all",
        using: sql`exists (select 1 from ${parentTable} where ${parentColumn} = ${link.parentId})`,
        withCheck: sql`exists (select 1 from ${parentTable} where ${parentColumn} = ${link.parentId})`,
      }),
    ],
  ).enableRLS();
}

export type FileLinksTable = ReturnType<typeof fileLinks>;
