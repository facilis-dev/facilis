import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

/** Drivers the public API promises; only PGlite is implemented in Phase 1. */
export type DbDriver = "pglite" | "postgres";

/**
 * Root Drizzle client type. It is the only Drizzle client type allowed to leak past
 * this package (AGENTS.md security rule 5 keeps raw Drizzle imports here).
 */
export type PgDatabaseLike = PgliteDatabase<Record<string, unknown>>;

/** A Drizzle schema namespace, e.g. `import * as schema from "./db/schema.ts"`. */
export type FacilisSchema = Readonly<Record<string, unknown>>;

export interface CreateDbOptions {
  readonly driver?: DbDriver;
  readonly url?: string;
  readonly dataDir?: string;
  /** Schema namespace used by migrations and by `schemaSnapshot`. */
  readonly schema?: FacilisSchema;
}

export interface FacilisDb {
  readonly driver: DbDriver;
  readonly db: PgDatabaseLike;
  readonly schema: FacilisSchema;
  close(): Promise<void>;
}

/** Column names treated as tenant scopes (SPEC §7.1 Appendix B defaults). */
export const DEFAULT_TENANT_COLUMNS: readonly string[] = ["tenantId", "tenant_id"];

/** Column names treated as per-row owner scopes (SPEC §7.1 Appendix B defaults). */
export const DEFAULT_OWNER_COLUMNS: readonly string[] = [
  "ownerId",
  "owner_id",
  "userId",
  "user_id",
];

/** Thrown instead of silently degrading when an unimplemented driver is requested. */
export class DriverNotImplementedError extends Error {
  readonly code = "driver_not_implemented";

  constructor(driver: DbDriver) {
    super(`The "${driver}" driver is not implemented in Phase 1. Use driver "pglite".`);
    this.name = "DriverNotImplementedError";
  }
}

/**
 * Opens the Facilis database. An explicit `url` without a driver means "postgres",
 * which rejects with DriverNotImplementedError — Phase 1 ships PGlite only.
 */
export async function createDb(options: CreateDbOptions = {}): Promise<FacilisDb> {
  const driver = options.driver ?? (options.url === undefined ? "pglite" : "postgres");
  if (driver === "postgres") throw new DriverNotImplementedError(driver);

  const client = options.dataDir === undefined ? new PGlite() : new PGlite(options.dataDir);
  // PGlite boots lazily; awaiting the ready promise makes createDb's contract truthful.
  await client.waitReady;

  return {
    driver,
    db: createDrizzleClient(client, options.schema),
    schema: options.schema ?? {},
    async close() {
      await client.close();
    },
  };
}

function createDrizzleClient(client: PGlite, schema: FacilisSchema | undefined): PgDatabaseLike {
  // The cast collapses Drizzle's schema-dependent generics: @facilis/db does not consume
  // the relational query API, and callers get typed query builders from their table objects.
  if (schema === undefined) return drizzle(client) as unknown as PgDatabaseLike;
  return drizzle(client, { schema: { ...schema } }) as unknown as PgDatabaseLike;
}
