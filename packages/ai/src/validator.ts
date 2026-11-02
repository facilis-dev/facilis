/**
 * The SPEC §9.3 patch validator: 16 rules, grouped by the part of the project they read.
 *
 * Without a context only the two context-free structural checks run (the parser gate);
 * with a context the full rule set runs. Rules 5, 13 and 14 are warnings (they never
 * block); the others are errors and make `ok` false, which is what stops the IDE's
 * apply path before it writes anything (invariant 9).
 */

import { buildEffectiveState } from "./overlay.ts";
import { blockImportErrors } from "./rules/blocks.ts";
import { roleConfigSyncErrors } from "./rules/config-sync.ts";
import { destructiveErrors, migrationWarnings, rlsErrors } from "./rules/database.ts";
import { i18nWarnings } from "./rules/i18n.ts";
import { importResolveErrors, rawDbAccessErrors } from "./rules/imports.ts";
import {
  permissionErrors,
  routeDbColumnsWarnings,
  routeDbTablesErrors,
} from "./rules/routes-metadata.ts";
import { routeSecurityErrors } from "./rules/routes-security.ts";
import { structuralErrors } from "./rules/structural.ts";
import { tsParseErrors } from "./rules/ts-parse.ts";
import type { FilePatch, ValidatePatchOptions, ValidationResult } from "./types.ts";

export function validatePatch(
  patches: readonly FilePatch[],
  options: ValidatePatchOptions = {},
): ValidationResult {
  const errors = structuralErrors(patches, options.allowedRootFiles);
  const warnings: ValidationResult["warnings"] = [];
  const context = options.context;
  if (context !== undefined) {
    const state = buildEffectiveState(context, patches);
    errors.push(...tsParseErrors(patches, context.syntax));
    errors.push(...routeSecurityErrors(state));
    errors.push(...routeDbTablesErrors(state, context));
    warnings.push(...routeDbColumnsWarnings(state, context));
    errors.push(...permissionErrors(state, context));
    errors.push(...blockImportErrors(state, context));
    errors.push(...rawDbAccessErrors(state));
    errors.push(...rlsErrors(state));
    errors.push(...importResolveErrors(state, context));
    warnings.push(...i18nWarnings(state));
    warnings.push(...migrationWarnings(patches, state));
    errors.push(...destructiveErrors(state, options.requiresConfirmation === true));
    errors.push(...roleConfigSyncErrors(patches, state));
  }
  return { ok: errors.length === 0, errors, warnings };
}
