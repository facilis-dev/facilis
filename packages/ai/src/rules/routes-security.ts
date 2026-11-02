/**
 * Rules 2 `route-security`, 3 `db-tables-present` and 8 `route-input-validated`
 * (SPEC §9.3), checked on the route files the patch creates or updates.
 */

import type { EffectiveState, PatchedSource } from "../overlay.ts";
import { isRoutePath } from "../paths.ts";
import { callsFunction, hasProperty } from "../scan.ts";
import type { ValidationError } from "../types.ts";

/** A body read: `ctx.body`, a `{ body }` handler destructure, or a nested access. */
const BODY_READ = /(?:\.\s*body\b|\bbody\s*[.[]|\{[^}]*\bbody\b[^}]*\})/;

/**
 * The route module's default export must be the wrapper. Directly
 * `export default defineAuthorizedHandler(...)` is the generated style; the
 * assign-then-export form is accepted too. A file that merely CALLS the wrapper
 * (e.g. for a helper) while exporting a raw handler is the bypass this rejects.
 */
function exportsAuthorizedHandler(masked: string): boolean {
  if (/\bexport\s+default\s+defineAuthorizedHandler\s*\(/.test(masked)) return true;
  const named = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(masked)?.[1];
  if (named === undefined) return false;
  return new RegExp(
    "\\b(?:const|let|var)\\s+" + named + "\\s*=\\s*defineAuthorizedHandler\\s*\\(",
  ).test(masked);
}

export function routeSources(state: EffectiveState): PatchedSource[] {
  return state.patchedSources.filter((source) => isRoutePath(source.path));
}

function error(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "error", file, message, fix_hint };
}

export function routeSecurityErrors(state: EffectiveState): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const source of routeSources(state)) {
    if (
      !callsFunction(source.masked, "defineAuthorizedHandler") ||
      !exportsAuthorizedHandler(source.masked)
    ) {
      errors.push(
        error(
          "route-security",
          source.path,
          "Every API route must be written with defineAuthorizedHandler.",
          "Wrap the handler in defineAuthorizedHandler (security invariant 1).",
        ),
      );
    }
    if (!hasProperty(source.masked, "dbTables")) {
      errors.push(
        error(
          "db-tables-present",
          source.path,
          "Route config must declare dbTables (an empty array when it touches no table).",
          "Add dbTables: [] or the list of tables the handler uses (security invariant 2).",
        ),
      );
    }
    if (BODY_READ.test(source.masked) && !hasProperty(source.masked, "body")) {
      errors.push(
        error(
          "route-input-validated",
          source.path,
          "The handler reads the request body but the route declares no body schema.",
          "Declare body: <ZodSchema> in the defineAuthorizedHandler config (security invariant 3).",
        ),
      );
    }
  }
  return errors;
}
