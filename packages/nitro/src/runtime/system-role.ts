import { ensureSystemRole, type FacilisDb } from "@facilis/db";
import type { ManifestWarning } from "@facilis/core";

/**
 * Boot step: provision `facilis_system` after the app role (D-099).
 *
 * A failure is a manifest warning, never a failed boot: without the role every sudo call
 * fails closed at SET ROLE, so the app degrades to "no escalation" instead of crashing.
 */
export async function provisionSystemRole(
  db: FacilisDb,
  warnings: ManifestWarning[],
): Promise<void> {
  try {
    await ensureSystemRole(db);
  } catch (error) {
    warnings.push({
      code: "system_role_failed",
      message: `Could not provision the system role: ${describe(error)}`,
    });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
