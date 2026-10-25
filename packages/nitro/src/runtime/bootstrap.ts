import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { applyStatements, createDb, ensureAppRole, type FacilisDb } from "@facilis/db";
import { seedStatements, sessionMiddleware, type SessionEvent } from "@facilis/auth";
import type { FacilisConfig, ManifestWarning } from "@facilis/core";
import config, { configError, projectRoot } from "#facilis/config";
import dbSchema from "#facilis/db-schema";

import { isFacilisConfig, readMigrationsDir, toAuthConfig } from "./config.ts";
import { isProductionEnvironment } from "./env.ts";
import { readTextFile } from "./project-files.ts";
import { splitSqlStatements } from "./sql.ts";

export interface BootstrapState {
  readonly db: FacilisDb | null;
  readonly config: FacilisConfig | null;
  readonly warnings: readonly ManifestWarning[];
  readonly startedAt: string;
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
    db: state.db.db,
    config: toAuthConfig(state.config.auth),
  });
  return state.sessionHandler;
}

async function bootstrap(): Promise<BootstrapState> {
  const warnings: ManifestWarning[] = [];
  const startedAt = new Date().toISOString();
  const projectConfig = readProjectConfig(warnings);
  if (projectConfig === null) return { db: null, config: null, warnings, startedAt };

  let db: FacilisDb;
  try {
    db = await createDb({
      driver: projectConfig.db.mode === "postgres" ? "postgres" : "pglite",
      schema: dbSchema,
    });
  } catch (error) {
    warnings.push(warning("db_unavailable", `Could not open the database: ${describe(error)}`));
    return { db: null, config: projectConfig, warnings, startedAt };
  }

  // Dev-only bootstrap: production schemas arrive through the committed migrations,
  // and the app role is provisioned by the deploy step, not by every worker boot.
  if (!isProductionEnvironment()) {
    await bootstrapDevelopmentDatabase(db, projectConfig, warnings);
  }

  return { db, config: projectConfig, warnings, startedAt };
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
