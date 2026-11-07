import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { applyStatements, applyViews, createDb, ensureAppRole, type FacilisDb } from "@facilis/db";
import { seedStatements, sessionMiddleware, type SessionEvent } from "@facilis/auth";
import { DEFAULT_JOBS_CONFIG, type FacilisConfig, type ManifestWarning } from "@facilis/core";
import config, { configError, projectRoot } from "#facilis/config";
import dbViewModules from "#facilis/db-views";
import dbSchema from "#facilis/db-schema";
import jobModules from "#facilis/jobs";

import { isFacilisConfig, readMigrationsDir, toAuthConfig } from "./config.ts";
import { resolveDbTarget } from "./db-target.ts";
import {
  devDbSnapshotPath,
  installDevDbSnapshotter,
  readDevDbSnapshot,
} from "./dev-db-persistence.ts";
import { isProductionEnvironment } from "./env.ts";
import { bootJobs } from "./jobs/boot.ts";
import type { JobsRuntime } from "./jobs/runtime.ts";
import { readDefaultTenantId } from "./tenant.ts";
import { readTextFile } from "./project-files.ts";
import { splitSqlStatements } from "./sql.ts";
import { provisionSystemRole } from "./system-role.ts";

export interface BootstrapState {
  readonly db: FacilisDb | null;
  readonly config: FacilisConfig | null;
  readonly warnings: readonly ManifestWarning[];
  readonly startedAt: string;
  /**
   * Background-job runtime (D-107); null when the db or the job boot failed. The context
   * middleware carries `jobs.api` on `event.context.facilis`.
   */
  readonly jobs: JobsRuntime | null;
  /** Cached session handler; rebuilt lazily because it closes over the db client. */
  sessionHandler?: (event: SessionEvent) => Promise<void>;
}

let bootstrapPromise: Promise<BootstrapState> | undefined;

/**
 * Boot the framework runtime once per process (lazily, on the first request).
 *
 * Contract (docs/PHASE1-CONTRACTS.md §8): never crash the request. Each failure is
 * recorded as a manifest warning and the remaining steps still run, so a broken
 * migration yields a 200 partial manifest instead of a 500.
 */
export function getBootstrap(): Promise<BootstrapState> {
  bootstrapPromise ??= bootstrap();
  return bootstrapPromise;
}

export function getSessionHandler(
  state: BootstrapState,
): ((event: SessionEvent) => Promise<void>) | null {
  if (state.db === null || state.config === null) return null;
  state.sessionHandler ??= sessionMiddleware({
    db: state.db,
    config: toAuthConfig(state.config.auth),
    tenantId: readDefaultTenantId(),
  });
  return state.sessionHandler;
}

async function bootstrap(): Promise<BootstrapState> {
  const warnings: ManifestWarning[] = [];
  const startedAt = new Date().toISOString();
  const projectConfig = readProjectConfig(warnings);
  if (projectConfig === null) {
    return { db: null, config: null, warnings, startedAt, jobs: null };
  }

  // The environment, not the config alone, decides where data lives (D-068): a deployment
  // sets a Postgres URL and the same build runs there. Every refusal is a warning, so a
  // misconfigured production boot degrades to "no database" instead of crashing.
  const resolved = resolveDbTarget(projectConfig, process.env);
  warnings.push(...resolved.warnings);
  if (resolved.target === null) {
    return { db: null, config: projectConfig, warnings, startedAt, jobs: null };
  }
  const target = resolved.target;
  const usesPglite = target.driver === "pglite";

  // Dev-only persistence (D-052): an in-memory PGlite cluster is restored from one snapshot
  // file in the project. A postgres target has no snapshot to read, and must not restore one.
  const devPersistenceEnabled = usesPglite && !isProductionEnvironment();
  const snapshotPath = devDbSnapshotPath(projectRoot);
  let snapshot: Uint8Array | null = null;
  if (devPersistenceEnabled) {
    try {
      snapshot = await readDevDbSnapshot(snapshotPath);
    } catch (error) {
      warnings.push(
        warning(
          "db_snapshot_unreadable",
          `Could not read the dev database snapshot: ${describe(error)}`,
        ),
      );
    }
  }

  let db: FacilisDb;
  try {
    db = await createDb({
      driver: target.driver,
      url: target.url,
      loadSnapshot: snapshot ?? undefined,
      schema: dbSchema,
    });
  } catch (error) {
    if (snapshot === null) {
      warnings.push(warning("db_unavailable", `Could not open the database: ${describe(error)}`));
      return { db: null, config: projectConfig, warnings, startedAt, jobs: null };
    }
    // A corrupt or incompatible snapshot must not make the project unbootable: warn and
    // start from an empty cluster instead (the old file is replaced by the next dump).
    // Only pglite ever reads a snapshot (see devPersistenceEnabled), so the retry keeps the
    // resolved driver instead of hard-coding one.
    warnings.push(
      warning(
        "db_snapshot_failed",
        `Could not restore the dev database snapshot, starting empty: ${describe(error)}`,
      ),
    );
    try {
      db = await createDb({
        driver: target.driver,
        url: target.url,
        schema: dbSchema,
      });
    } catch (retryError) {
      warnings.push(
        warning("db_unavailable", `Could not open the database: ${describe(retryError)}`),
      );
      return { db: null, config: projectConfig, warnings, startedAt, jobs: null };
    }
  }

  // The dev bootstrap keeps a PGlite project self-contained: migrations -> seed -> app role
  // (D-052). A real Postgres is provisioned out of band by the deploy step; the runtime may
  // even connect as facilis_app, which can neither create roles nor run schema changes.
  if (usesPglite) {
    await bootstrapDevelopmentDatabase(db, projectConfig, warnings);
  } else {
    warnings.push(
      warning(
        "db_migrations_skipped",
        "Postgres target: migrations, roles and views are provisioned by the deploy step, not at boot.",
      ),
    );
    // Views are DDL like migrations: a restricted runtime role cannot create them, so the
    // deploy step owns them and the boot only reports that it skipped the step.
    if (dbViewModules.length > 0) {
      warnings.push(
        warning(
          "view_ddl_skipped",
          "Postgres target: SQL views are provisioned by the deploy step, not at boot.",
        ),
      );
    }
  }

  if (devPersistenceEnabled) {
    installDevDbSnapshotter({
      db,
      projectRoot,
      snapshotPath,
      onError: (error) => {
        // One warning per process is enough: a full disk would otherwise flood the manifest.
        if (!warnings.some((entry) => entry.code === "db_snapshot_write_failed")) {
          warnings.push(
            warning(
              "db_snapshot_write_failed",
              `Could not write the dev database snapshot: ${describe(error)}`,
            ),
          );
        }
      },
    });
  }

  // The queue starts after the roles/views exist: its own writes run as facilis_app, while
  // a job body escalates to facilis_system (D-107). A failure there is a warning, not a 500.
  const jobs = await bootJobs({
    db,
    // isFacilisConfig deliberately does not require `jobs`, so an older virtual config can
    // still hand an undefined section to a newer runtime: fall back to the documented defaults.
    jobsConfig: projectConfig.jobs ?? DEFAULT_JOBS_CONFIG,
    modules: jobModules,
    tenantId: readDefaultTenantId(),
    warnings,
  });

  return { db, config: projectConfig, warnings, startedAt, jobs };
}

function readProjectConfig(warnings: ManifestWarning[]): FacilisConfig | null {
  if (configError !== undefined) {
    warnings.push(warning("config_load_failed", configError));
    return null;
  }
  if (!isFacilisConfig(config)) {
    warnings.push(
      warning(
        "config_invalid",
        "facilis.config.ts must export defineConfig({ auth, db, i18n, ... }).",
      ),
    );
    return null;
  }
  return config;
}

async function bootstrapDevelopmentDatabase(
  db: FacilisDb,
  projectConfig: FacilisConfig,
  warnings: ManifestWarning[],
): Promise<void> {
  // Order mandated by the Lead: migrations -> seed (roles/role_permissions) -> app role.
  try {
    const statements = await readMigrationStatements(projectConfig);
    if (statements.length > 0) await applyStatements(db, statements);
  } catch (error) {
    warnings.push(warning("migration_failed", `Migrations failed: ${describe(error)}`));
  }

  try {
    await applyStatements(db, seedStatements(toAuthConfig(projectConfig.auth)));
  } catch (error) {
    warnings.push(warning("seed_failed", `Seeding roles/permissions failed: ${describe(error)}`));
  }

  try {
    await ensureAppRole(db);
  } catch (error) {
    warnings.push(
      warning("app_role_failed", `Could not provision the app role: ${describe(error)}`),
    );
  }

  // D-099: the system role is the sudo identity; provision it after the app role so the
  // membership grant can reference it.
  await provisionSystemRole(db, warnings);

  // Views are code (D-097): create/replace them after the app role exists, because the
  // security_invoker view must be granted to that role. A broken view is a warning, never a
  // failed boot, and the endpoint returns the same failures on demand.
  if (dbViewModules.length === 0) return;
  try {
    const applied = await applyViews(db, dbViewModules, {
      permissions: projectConfig.auth.permissions,
    });
    for (const failure of applied.failed) {
      warnings.push(
        warning("view_failed", `View "${failure.name}" could not be created: ${failure.error}`),
      );
    }
  } catch (error) {
    warnings.push(warning("view_failed", `Views could not be applied: ${describe(error)}`));
  }
}

async function readMigrationStatements(projectConfig: FacilisConfig): Promise<string[]> {
  const dir = join(projectRoot, readMigrationsDir(projectConfig));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    // No migrations directory is a valid early-project state.
    if (isMissingFileError(error)) return [];
    throw error;
  }

  const names = entries.filter((name) => name.endsWith(".sql")).toSorted();
  const contents = await Promise.all(names.map((name) => readTextFile(join(dir, name))));
  const statements: string[] = [];
  for (const source of contents) {
    if (source !== null) statements.push(...splitSqlStatements(source));
  }
  return statements;
}

function warning(code: string, message: string): ManifestWarning {
  return { code, message };
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
