/**
 * Rule 16 `role-config-sync` (SPEC §9.3): the `role_permissions` seed is generated from
 * `facilis.config.ts` at release (D-158), exactly like the DDL, so a role/permission change
 * ships no migration and needs none. What is left to check is that the patched auth block is
 * readable: when it is not, the sync cannot be verified, so the rule fails closed instead of
 * assuming "no auth change".
 */

import { CONFIG_PATH, type EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { FilePatch, ValidationError } from "../types.ts";

export function roleConfigSyncErrors(
  patches: readonly FilePatch[],
  state: EffectiveState,
): ValidationError[] {
  const touchesConfig = patches.some((patch) => {
    return normalizeProjectPath(patch.path) === CONFIG_PATH && patch.action !== "delete";
  });
  if (!touchesConfig || state.config.parsed) return [];
  return [
    {
      rule: "role-config-sync",
      severity: "error",
      file: CONFIG_PATH,
      message:
        "The auth block of the patched facilis.config.ts could not be read, so the role/permission sync cannot be verified.",
      fix_hint:
        "Keep the auth declaration as an object literal inside defineConfig so the validator can read it.",
    },
  ];
}
