import { createRequire } from "node:module";
import { join } from "node:path";

import type { PGlite as PgliteClient } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

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

/** Drivers the public API promises. Both are implemented; `snapshot()` is PGlite-only. */
export type DbDriver = "pglite" | "postgres";

/**
 * Result kind shared by both drivers. drizzle's abstract `PgQueryResultHKT` only brands the
 * kind (`type: unknown`), which would degrade every `execute()` result to `unknown`;
 * PGlite and node-postgres both resolve to a `{ rows }` object, so this HKT restores the
 * common surface for the driver-agnostic client type.
 */
export interface FacilisQueryResultHKT extends PgQueryResultHKT {
  readonly type: { readonly rows: Record<string, unknown>[] };
}

/**
 * Root Drizzle client type. It is the only Drizzle client type allowed to leak past
 * this package (AGENTS.md security rule 5 keeps raw Drizzle imports here). Both drivers
 * cast their concrete client to this base class: the per-driver `$client` is never used
 * here, so PGlite and node-postgres collapse to the shared Postgres query surface.
 */
export type PgDatabaseLike = PgDatabase<FacilisQueryResultHKT, Record<string, unknown>>;

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
  /** Maximum pooled connections for driver "postgres" (`pg.Pool` `max`). Defaults to 10. */
  readonly poolMax?: number;
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
  /**
   * Serialize the whole cluster as the gzip tar the `loadSnapshot` option restores.
   * Only driver "pglite" can dump itself; driver "postgres" throws SnapshotUnavailableError.
   */
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

/** Thrown for a driver id that neither branch below can serve. */
export class DriverNotImplementedError extends Error {
  readonly code = "driver_not_implemented";

  constructor(driver: DbDriver) {
    super(`The "${driver}" driver is not implemented; use driver "pglite" or "postgres".`);
    this.name = "DriverNotImplementedError";
  }
}

/** Thrown instead of resolving when the postgres pool cannot be opened or probed. */
export class DbConnectionError extends Error {
  readonly code = "db_connection_failed";

  constructor(cause: unknown) {
    // The connection string may embed a password, so neither it nor the driver message
    // (which repeats host/port) is forwarded into the public message.
    super("The postgres driver could not connect; check the database settings.", { cause });
    this.name = "DbConnectionError";
  }
}

/** Thrown by snapshot() on a driver that has no hot cluster dump. */
export class SnapshotUnavailableError extends Error {
  readonly code = "snapshot_unavailable";

  constructor() {
    super('The postgres driver has no cluster dump; snapshot() is available only for "pglite".');
    this.name = "SnapshotUnavailableError";
  }
}

/**
 * Opens the Facilis database. An explicit `url` without a driver means "postgres";
 * `driver: "pglite"` is the embedded, in-memory or `dataDir` cluster.
 */
export async function createDb(options: CreateDbOptions = {}): Promise<FacilisDb> {
  const driver = options.driver ?? (options.url === undefined ? "pglite" : "postgres");
  // facilis.config.ts is user code and may be plain JavaScript, so re-check the union.
  if (driver !== "pglite" && driver !== "postgres") throw new DriverNotImplementedError(driver);
  return driver === "postgres" ? openPostgresDb(options) : openPgliteDb(options);
}

async function openPgliteDb(options: CreateDbOptions): Promise<FacilisDb> {
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
    driver: "pglite",
    db: createPgliteDrizzleClient(tracked, options.schema),
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

async function openPostgresDb(options: CreateDbOptions): Promise<FacilisDb> {
  const { pg, drizzle: drizzlePg } = loadPostgres();
  const url = options.url;
  if (url === undefined) throw new DbConnectionError(new Error("no connection url was provided"));

  const pool = new pg.Pool({
    connectionString: url,
    max: options.poolMax ?? 10,
    application_name: "facilis",
    // TLS comes from the connection string (e.g. ?sslmode=require) and pg parses it there;
    // this layer must not re-implement it.
  });

  try {
    // The pool is lazy: without the probe a bad URL would resolve createDb and only fail
    // on the first request, which the framework treats as a runtime bug instead of config.
    await pool.query("select 1");
  } catch (cause) {
    // The failed probe leaves the pool unusable; draining it is best effort.
    await pool.end().catch(() => undefined);
    throw new DbConnectionError(cause);
  }

  const schema = options.schema;
  // Same generic collapse as the PGlite client: callers get builders from their tables.
  const db = (schema === undefined
    ? drizzlePg(pool)
    : drizzlePg(pool, { schema: { ...schema } })) as unknown as PgDatabaseLike;

  return {
    driver: "postgres",
    db,
    schema: schema ?? {},
    // The dev snapshotter (D-052) is installed only for driver "pglite" and polls that
    // client's counter; a remote Postgres cluster has no equivalent hook.
    activity: () => 0,
    async snapshot(): Promise<Uint8Array> {
      throw new SnapshotUnavailableError();
    },
    async close() {
      await pool.end();
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

function createPgliteDrizzleClient(
  client: PgliteClient,
  schema: FacilisSchema | undefined,
): PgDatabaseLike {
  // The cast collapses Drizzle's schema-dependent generics: @facilis/db does not consume
  // the relational query API, and callers get typed query builders from their table objects.
  if (schema === undefined) return drizzle(client) as unknown as PgDatabaseLike;
  return drizzle(client, { schema: { ...schema } }) as unknown as PgDatabaseLike;
}

interface PostgresModules {
  readonly pg: typeof import("pg");
  readonly drizzle: typeof import("drizzle-orm/node-postgres").drizzle;
}

/**
 * `pg` (node:net/node:tls) and drizzle's node-postgres driver are loaded lazily: the
 * generated project runs server code inside a WebContainer, where the postgres branch is
 * inert, and a static import would drag Node's socket stack into the in-VM bundle. Same
 * two resolution bases as loadPglite: this module's URL, then the project root.
 */
function loadPostgres(): PostgresModules {
  let lastError: unknown;
  for (const base of [import.meta.url, join(process.cwd(), "package.json")]) {
    try {
      const require = createRequire(base);
      const pg = require("pg") as typeof import("pg");
      const driver =
        require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
      return { pg, drizzle: driver.drizzle };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("facilis: cannot load pg / drizzle-orm/node-postgres — are they installed?", {
    cause: lastError,
  });
}
