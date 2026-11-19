import { join } from "node:path";

import { applyStatements, applyViews, ensureAppRole, type FacilisDb } from "@facilis.dev/db";
import { parseSchemaApprovals, SCHEMA_APPROVALS_PATH } from "@facilis.dev/core";
import { seedStatements } from "@facilis.dev/auth";
import type { FacilisConfig, ManifestWarning } from "@facilis.dev/core";
import { projectRoot } from "#facilis/config";
import dbViewModules from "#facilis/db-views";

import { toAuthConfig } from "./config.ts";
import { reconcileDeclaredSchema } from "./schema-reconcile.ts";
import { readTextFile } from "./project-files.ts";
import { provisionSystemRole } from "./system-role.ts";

/**
 * Dev-only database bootstrap: declared schema -> seed -> app role -> system role -> views
 * (D-052/D-097/D-099/D-193). Split from `bootstrap.ts` to keep both modules under the
 * file-length limit; a Postgres target skips this module entirely, because the deploy step
 * owns DDL.
 */
export async function bootstrapDevelopmentDatabase(
  db: FacilisDb,
  projectConfig: FacilisConfig,
  warnings: ManifestWarning[],
): Promise<void> {
  // Order mandated by the Lead: declared schema -> seed (roles/role_permissions) -> app role.
  // D-193: the declared schema is the source of truth in dev; the reconcile creates what
  // db/schema.ts added since, and never drops anything the user did not confirm.
  try {
    const approvals = await readTextFile(join(projectRoot, SCHEMA_APPROVALS_PATH));
    await reconcileDeclaredSchema(
      db,
      approvals === null ? [] : parseSchemaApprovals(approvals),
      warnings,
    );
  } catch (error) {
    warnings.push(
      warning("schema_reconcile_failed", `Schema reconcile failed: ${describe(error)}`),
    );
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

function warning(code: string, message: string): ManifestWarning {
  return { code, message };
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
