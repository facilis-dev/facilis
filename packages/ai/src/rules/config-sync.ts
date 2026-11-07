/**
 * Rule 16 `role-config-sync` (SPEC §9.3): changing roles or permissions in
 * `facilis.config.ts` requires a new migration that updates the `role_permissions`
 * seed. The table is a projection of the config (SPEC §5.3), so without the migration the
 * live database silently disagrees with the code.
 */

import { hasMigrationPatch, CONFIG_PATH, type EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { ConfigFacts, FilePatch, ValidationError } from "../types.ts";

function changedFacts(before: ConfigFacts, after: ConfigFacts): string[] {
  const changes: string[] = [];
  for (const permission of after.permissions) {
    if (!before.permissions.includes(permission))
      changes.push('adds permission "' + permission + '"');
  }
  for (const permission of before.permissions) {
    if (!after.permissions.includes(permission))
      changes.push('removes permission "' + permission + '"');
  }
  const beforeRoles = JSON.stringify(before.roles);
  const afterRoles = JSON.stringify(after.roles);
  if (beforeRoles !== afterRoles) changes.push("changes auth.roles");
  if ((before.defaultRole ?? "") !== (after.defaultRole ?? "")) {
    changes.push('changes defaultRole to "' + (after.defaultRole ?? "") + '"');
  }
  return changes;
}

export function roleConfigSyncErrors(
  patches: readonly FilePatch[],
  state: EffectiveState,
): ValidationError[] {
  const touchesConfig = patches.some((patch) => {
    return normalizeProjectPath(patch.path) === CONFIG_PATH && patch.action !== "delete";
  });
  if (!touchesConfig) return [];
  const errors: ValidationError[] = [];
  const after = state.config;
  // A config patch the scan cannot read is unverifiable: rule 16 fails closed instead of
  // assuming "no auth change". The pre-patch source may be unparseable for the same
  // reason, so the check is on the patched content itself.
  if (!after.parsed) {
    errors.push({
      rule: "role-config-sync",
      severity: "error",
      file: CONFIG_PATH,
      message:
        "The auth block of the patched facilis.config.ts could not be read, so the role/permission sync cannot be verified.",
      fix_hint:
        "Keep the auth declaration as an object literal inside defineConfig so the validator can read it.",
    });
    return errors;
  }
  const changes = changedFacts(state.before.config, after);
  if (changes.length === 0 || hasMigrationPatch(patches, state.migrationsDir)) return [];
  errors.push({
    rule: "role-config-sync",
    severity: "error",
    file: CONFIG_PATH,
    message:
      "The patch " +
      changes.slice(0, 3).join(", ") +
      " but ships no migration updating role_permissions.",
    fix_hint:
      "Add a migration under " +
      state.migrationsDir +
      "/ that reseeds role_permissions from the config (SPEC §5.3, rule 16).",
  });
  return errors;
}
