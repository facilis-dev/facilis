import { createRequire } from "node:module";
import { join } from "node:path";

import type { PGlite as PgliteClient } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

/**
 * PGlite must come from its CJS build (vendor/vivari/AGENTS.md, "In-VM databases"):
 * the ESM build locates `pglite.wasm` and `pglite.data` through `import.meta.url`, and
 * that URL is only as good as the module id the bundler handed the module. A relative id
 * becomes `file://home/…` — the first segment parses as a URL *host* — so the resolved
 * path loses `/home` (`/user/projects/…`) and the DB cannot boot with ENOENT. The CJS
 * build resolves the same artifacts from `__filename`, a real VFS path, through
 * `new URL("file:" + __filename)` = `file:/home/…`; the pinned runtime converts that back
 * to the intended path even where the browser parses it as hostful, i.e. on Chrome/Windows
 * (fork `e654919`, D-039 and D-041).
 *
 * Two resolution bases: this module's own URL (works in Node and under Vitest), then the
 * project root, which is the cwd the in-VM Nitro dev server runs in.
 */
function loadPglite(): typeof import("@electric-sql/pglite") {
  let lastError: unknown;
  for (const base of [import.meta.url, join(process.cwd(), "package.json")]) {
    try {
      return createRequire(base)("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("facilis: cannot load @electric-sql/pglite — is it installed?", {
    cause: lastError,
  });
}

const { PGlite } = loadPglite();

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
  /**
   * Restore a `snapshot()` archive instead of starting from an empty cluster.
   * Dev persistence (D-052) keeps the cluster in memory and restores it from
   * `.facilis/db/snapshot.tar.gz`; production uses a real Postgres instead.
   */
  readonly loadSnapshot?: Uint8Array;
  /** Schema namespace used by migrations and by `schemaSnapshot`. */
  readonly schema?: FacilisSchema;
}

export interface FacilisDb {
  readonly driver: DbDriver;
  readonly db: PgDatabaseLike;
  readonly schema: FacilisSchema;
  close(): Promise<void>;
  /**
   * Monotonic count of client operations (query/exec/transaction). The dev snapshotter
   * polls this instead of every write: only a cluster that changed is dumped.
   */
  activity(): number;
  /** Serialize the whole cluster as the gzip tar the `loadSnapshot` option restores. */
  snapshot(): Promise<Uint8Array>;
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

  const client = await openPglite(options);
  const activity = { count: 0 };
  // Drizzle talks to this facade; counting here is the only reliable "did the cluster
  // change since the last dump" signal, because PGlite exposes no change hook. Methods
  // are bound to the real client so `this` and the WASM instance are untouched.
  const tracked = new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property === "query" || property === "exec" || property === "transaction") {
        return (...args: unknown[]) => {
          activity.count += 1;
          return (value as (...inner: unknown[]) => unknown).apply(target, args);
        };
      }
      return (value as (...inner: unknown[]) => unknown).bind(target);
    },
  }) as PgliteClient;

  return {
    driver,
    db: createDrizzleClient(tracked, options.schema),
    schema: options.schema ?? {},
    activity: () => activity.count,
    async snapshot() {
      const dump = await client.dumpDataDir("gzip");
      return new Uint8Array(await dump.arrayBuffer());
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Open the PGlite cluster: from a dev snapshot when one is supplied, else from
 * `dataDir`, else empty.
 *
 * The restore goes through the documented static `create({ loadDataDir })`: the
 * constructor overload accepts the option but does not wire it (measured), and a
 * silently empty restore is the one failure a dev database must not have.
 */
async function openPglite(options: CreateDbOptions): Promise<PgliteClient> {
  const snapshot = options.loadSnapshot;
  if (snapshot !== undefined && snapshot.length > 0) {
    // Copy into a plain ArrayBuffer-backed view: a Uint8Array<ArrayBufferLike> is not a
    // BlobPart (its buffer could be a SharedArrayBuffer), and the archive is small.
    const bytes = new Uint8Array(snapshot.byteLength);
    bytes.set(snapshot);
    return (await PGlite.create({
      loadDataDir: new Blob([bytes]),
    })) as PgliteClient;
  }
  const client = options.dataDir === undefined ? new PGlite() : new PGlite(options.dataDir);
  // PGlite boots lazily; awaiting the ready promise makes createDb's contract truthful.
  await client.waitReady;
  return client;
}

function createDrizzleClient(
  client: PgliteClient,
  schema: FacilisSchema | undefined,
): PgDatabaseLike {
  // The cast collapses Drizzle's schema-dependent generics: @facilis/db does not consume
  // the relational query API, and callers get typed query builders from their table objects.
  if (schema === undefined) return drizzle(client) as unknown as PgDatabaseLike;
  return drizzle(client, { schema: { ...schema } }) as unknown as PgDatabaseLike;
}
