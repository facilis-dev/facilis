/**
 * The SPEC §9.3 patch validator: 19 rules, grouped by the part of the project they read.
 *
 * Without a context only the two context-free structural checks run (the parser gate);
 * with a context the full rule set runs. Rules 5, 13, 14 and 17 are warnings (they never
 * block); the others are errors and make `ok` false, which is what stops the IDE's apply
 * path before it writes anything (invariant 9).
 *
 * Every contextual rule reads @facilis.dev/analyze's fact model (D-092): the effective
 * post-patch Analysis supplied by the caller, never a re-parse of the patch text.
 */

import { buildEffectiveState } from "./overlay.ts";
import { blockImportErrors } from "./rules/blocks.ts";
import { roleConfigSyncErrors } from "./rules/config-sync.ts";
import { destructiveErrors, migrationWarnings, rlsErrors } from "./rules/database.ts";
import { i18nWarnings } from "./rules/i18n.ts";
import { importResolveErrors, rawDbAccessErrors } from "./rules/imports.ts";
import { jobTableDeclaredFindings } from "./rules/job-relations.ts";
import { routeTableDeclaredFindings } from "./rules/route-relations.ts";
import { routeDescriptionWarnings } from "./rules/routes-description.ts";
import {
  permissionErrors,
  routeDbColumnsWarnings,
  routeDbTablesErrors,
} from "./rules/routes-metadata.ts";
import {
  routeDbTablesPresentErrors,
  routeInputErrors,
  routeSecurityErrors,
} from "./rules/routes-security.ts";
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
    errors.push(...routeDbTablesPresentErrors(state));
    errors.push(...routeDbTablesErrors(state));
    warnings.push(...routeDbColumnsWarnings(state));
    errors.push(...permissionErrors(state));
    errors.push(...blockImportErrors(state, context));
    errors.push(...routeInputErrors(state));
    errors.push(...rawDbAccessErrors(state));
    errors.push(...rlsErrors(state));
    errors.push(...importResolveErrors(state, context));
    warnings.push(...i18nWarnings(state));
    warnings.push(...migrationWarnings(patches, state));
    errors.push(...destructiveErrors(state, options.requiresConfirmation === true));
    errors.push(...roleConfigSyncErrors(patches, state));
    warnings.push(...routeDescriptionWarnings(state));
    // D-157 rule 18: dbTables is applied over every effective route, not only patched ones.
    const routeTables = routeTableDeclaredFindings(state);
    errors.push(...routeTables.errors);
    warnings.push(...routeTables.warnings);
    // D-157 rule 19: the same declaration, applied to every effective job's system client.
    const jobTables = jobTableDeclaredFindings(state);
    errors.push(...jobTables.errors);
    warnings.push(...jobTables.warnings);
  }
  return { ok: errors.length === 0, errors, warnings };
}
