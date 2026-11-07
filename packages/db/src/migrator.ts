import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import type { FacilisDb } from "./client.ts";

/** drizzle-kit separates statements in generated SQL files with this marker. */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** Bookkeeping table owned by this package, not by the project schema: introspection skips it. */
export const MIGRATION_TRACKING_TABLE = "_facilis_applied_statements";

export type MigrationSource = string | readonly string[] | { readonly directory: string };

/**
 * Applies statements in order inside one transaction. Statements are keyed by content
 * hash and skipped when already applied, so bootstrapping a persistent dataDir twice is
 * safe; a failure rolls back both the statements and the tracking rows.
 *
 * Array entries may either be one SQL statement or a whole file separated by drizzle-kit's
 * "--> statement-breakpoint" marker (plain semicolons are never used as separators).
 */
export async function applyStatements(db: FacilisDb, statements: readonly string[]): Promise<void> {
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS ${MIGRATION_TRACKING_TABLE} (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
      ),
    );

    for (const statement of statements.flatMap(splitStatementBatch)) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;

      // no-await-in-loop: statements must run one at a time on the transaction's connection.
      // eslint-disable-next-line no-await-in-loop
      const hashed = await tx.execute(sql`select md5(${trimmed}) as id`);
      const row = hashed.rows[0];
      if (row === undefined || typeof row.id !== "string") {
        throw new Error("applyStatements: failed to hash a migration statement");
      }
      const id = row.id;

      // eslint-disable-next-line no-await-in-loop
      const seen = await tx.execute(
        sql`select 1 from ${sql.identifier(MIGRATION_TRACKING_TABLE)} where id = ${id}`,
      );
      if (seen.rows.length > 0) continue;

      // eslint-disable-next-line no-await-in-loop
      await tx.execute(sql.raw(trimmed));
      // eslint-disable-next-line no-await-in-loop
      await tx.execute(
        sql`insert into ${sql.identifier(MIGRATION_TRACKING_TABLE)} (id) values (${id})`,
      );
    }
  });
}

/**
 * Convenience runner for tests/examples: plain SQL text, a statement list, or a directory
 * of drizzle-kit `.sql` files (applied in filename order).
 */
export async function applyMigrations(db: FacilisDb, source: MigrationSource): Promise<void> {
  const statements =
    typeof source === "string"
      ? [source]
      : isMigrationDirectory(source)
        ? readMigrationDirectory(source.directory)
        : source;
  await applyStatements(db, statements);
}

function splitStatementBatch(batch: string): string[] {
  return batch.split(STATEMENT_BREAKPOINT);
}

function isMigrationDirectory(
  source: string | readonly string[] | { readonly directory: string },
): source is { readonly directory: string } {
  return typeof source === "object" && "directory" in source;
}

function readMigrationDirectory(directory: string): string[] {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .toSorted();

  return files.map((file) => readFileSync(join(directory, file), "utf8"));
}
