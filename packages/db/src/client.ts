import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { PGlite as PgliteClient, PGliteOptions } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import { installFileUrlRecovery } from "./file-url-recovery.ts";

/**
 * PGlite must come from its CJS build (vendor/vivari/AGENTS.md, "In-VM databases"):
 * the ESM build locates `pglite.wasm` and `pglite.data` through `import.meta.url`, and
 * that URL is only as good as the module id the bundler handed the module — a relative
 * id becomes `file://home/…`, whose first segment parses as a URL *host*. The CJS build
 * resolves them from `__filename`, a real VFS path.
 *
 * Two resolution bases: this module's own URL (works in Node and under Vitest), then the
 * project root, which is the cwd the in-VM Nitro dev server runs in. The resolved entry's
 * directory is kept because the artifacts live next to it.
 */
interface LoadedPglite {
  readonly module: typeof import("@electric-sql/pglite");
  readonly distDir: string;
}

function loadPglite(): LoadedPglite {
  let lastError: unknown;
  for (const base of [import.meta.url, join(process.cwd(), "package.json")]) {
    try {
      const load = createRequire(base);
      return {
        module: load("@electric-sql/pglite") as typeof import("@electric-sql/pglite"),
        distDir: dirname(load.resolve("@electric-sql/pglite")),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("facilis: cannot load @electric-sql/pglite — is it installed?", {
    cause: lastError,
  });
}

const pglite = loadPglite();
const { PGlite } = pglite.module;

/**
 * The wasm/data bytes PGlite would otherwise locate itself (D-041). Its CJS build builds
 * `new URL("file:" + __filename)` — `file:/home/…` — and while Node and current Chromium
 * read that as an empty-host URL, some browsers parse the first path segment as the HOST:
 * `file://home/…`, so `/home` is gone and every read lands outside the tree
 * (`File URL host must be "localhost" or empty on posix`). Handing PGlite the bytes makes
 * the lookup impossible: read them beside the resolved entry — an absolute VFS path, no
 * URL parsing anywhere — compile the wasm once, and share it across databases.
 */
type PgliteArtifacts = Pick<PGliteOptions, "fsBundle" | "pgliteWasmModule" | "initdbWasmModule">;

type WasmModule = NonNullable<PgliteArtifacts["pgliteWasmModule"]>;

/** This package's lib is ES2023 only (no DOM), so `WebAssembly` is reached globally. */
const wasm = (
  globalThis as unknown as { WebAssembly?: { Module: new (bytes: Uint8Array) => WasmModule } }
).WebAssembly;

function compileWasm(bytes: Uint8Array): WasmModule {
  if (!wasm) throw new Error("WebAssembly is unavailable in this runtime");
  return new wasm.Module(bytes);
}

let artifacts: PgliteArtifacts | null | undefined;

function pgliteArtifacts(): PgliteArtifacts | null {
  if (artifacts !== undefined) return artifacts;
  try {
    const read = (name: string) => readFileSync(join(pglite.distDir, name));
    artifacts = {
      fsBundle: new Blob([read("pglite.data")]),
      pgliteWasmModule: compileWasm(read("pglite.wasm")),
      initdbWasmModule: compileWasm(read("initdb.wasm")),
    };
  } catch {
    // A layout without the files keeps PGlite's own lookup: never fail the DB here.
    artifacts = null;
  }
  return artifacts;
}

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

  // PGlite boots lazily; awaiting the ready promise makes createDb's contract truthful. The
  // recovery shim covers the init's own file: URL lookup on a browser that parses it
  // hostfully (file-url-recovery.ts, kele23/vivari#2); it is restored as soon as the boot
  // finishes, so the builtin is untouched for the rest of the request.
  const restore = installFileUrlRecovery();
  let client: PgliteClient;
  try {
    client = new PGlite({ ...pgliteArtifacts(), dataDir: options.dataDir });
    await client.waitReady;
  } finally {
    restore?.();
  }

  return {
    driver,
    db: createDrizzleClient(client, options.schema),
    schema: options.schema ?? {},
    async close() {
      await client.close();
    },
  };
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
