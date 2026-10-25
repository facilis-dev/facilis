/**
 * @facilis/db — Drizzle + PGlite client and policy helpers.
 *
 * Phase 0 skeleton: `createDb` records the requested driver only. The Drizzle adapter,
 * RLS migration plugin and release diff engine arrive with the first real schema work.
 */

export type DbDriver = "pglite" | "postgres";

export interface CreateDbOptions {
  driver?: DbDriver;
  url?: string;
}

export interface FacilisDb {
  readonly driver: DbDriver;
  close(): Promise<void>;
}

export function createDb(options: CreateDbOptions = {}): FacilisDb {
  const driver = options.driver ?? "pglite";

  return {
    driver,
    async close() {
      // Placeholder until the Drizzle client owns a connection pool.
    },
  };
}
