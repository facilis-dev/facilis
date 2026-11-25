/**
 * The SPEC §9.3 patch validator: 20 rules, grouped by the part of the project they read.
 *
 * Without a context only the three context-free structural checks run (paths, content
 * presence, JSON parse); with a context the full rule set runs. Rules 5, 13 and 17 only warn;
 * rules 18-20 warn alongside their errors; every other finding is an error and makes `ok`
 * false, which is what stops the IDE's apply path before it writes anything (invariant 9).
 *
 * Every contextual rule reads @facilis.dev/analyze's fact model (D-092): the effective
 * post-patch Analysis supplied by the caller, never a re-parse of the patch text.
 */

import { buildEffectiveState } from "./overlay.ts";
import { blockImportErrors } from "./rules/blocks.ts";
import { roleConfigSyncErrors } from "./rules/config-sync.ts";
import {
  destructiveChanges,
  destructiveErrors,
  migrationErrors,
  rlsErrors,
  tableClassFindings,
} from "./rules/database.ts";
import { i18nWarnings } from "./rules/i18n.ts";
import { importResolveErrors, rawDbAccessErrors } from "./rules/imports.ts";
import { jobTableDeclaredFindings } from "./rules/job-relations.ts";
import { jsonParseErrors } from "./rules/json-parse.ts";
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
  const errors = structuralErrors(patches, {
    allowedRootFiles: options.allowedRootFiles ?? [],
    writePolicy: options.writePolicy ?? "managed",
  });
  errors.push(...jsonParseErrors(patches));
  const warnings: ValidationResult["warnings"] = [];
  let destructive = false;
  let drops: string[] = [];
  const context = options.context;
  if (context !== undefined) {
    const state = buildEffectiveState(context, patches);
    drops = destructiveChanges(state);
    destructive = drops.length > 0;
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
    // D-211 rule 20: every project table declares its access class (invariant 4).
    const tableClass = tableClassFindings(state);
    errors.push(...tableClass.errors);
    warnings.push(...tableClass.warnings);
    errors.push(...importResolveErrors(state, context));
    warnings.push(...i18nWarnings(state));
    errors.push(...migrationErrors(patches));
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
  return { ok: errors.length === 0, errors, warnings, destructive, destructiveChanges: drops };
}
