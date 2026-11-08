import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { applyStatements, applyViews, ensureAppRole, type FacilisDb } from "@facilis/db";
import { seedStatements } from "@facilis/auth";
import type { FacilisConfig, ManifestWarning } from "@facilis/core";
import { projectRoot } from "#facilis/config";
import dbViewModules from "#facilis/db-views";

import { readMigrationsDir, toAuthConfig } from "./config.ts";
import { readTextFile } from "./project-files.ts";
import { splitSqlStatements } from "./sql.ts";
import { provisionSystemRole } from "./system-role.ts";

/**
 * Dev-only database bootstrap: migrations -> seed -> app role -> system role -> views
 * (D-052/D-097/D-099). Split from `bootstrap.ts` to keep both modules under the file-length
 * limit; a Postgres target skips this module entirely, because the deploy step owns DDL.
 */
export async function bootstrapDevelopmentDatabase(
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

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
