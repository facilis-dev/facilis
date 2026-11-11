/**
 * Rules 2 `route-security`, 3 `db-tables-present` and 8 `route-input-validated`
 * (SPEC §9.3), checked on the routes whose source file the patch creates or updates.
 *
 * The facts come from @facilis.dev/analyze's route pass: wrapper resolution, `dbTables` and the
 * handler's body read are AST facts, so a route cannot look valid by mentioning the wrapper
 * in a comment or a string. A route file with an invalid wrapper is still listed by the
 * analyzer, which is what lets rule 2 see it.
 */

import type { EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { RouteFact, ValidationError } from "../types.ts";

/** Routes whose source file the patch creates or updates (deleted files have no facts). */
export function patchedRoutes(state: EffectiveState): RouteFact[] {
  return state.analysis.routes.filter((route) =>
    state.patchedPaths.has(normalizeProjectPath(route.sourceFile)),
  );
}

function error(rule: string, route: RouteFact, message: string, fix_hint: string): ValidationError {
  return {
    rule,
    severity: "error",
    file: route.sourceFile,
    message,
    fix_hint,
    line: route.source.line,
  };
}

/** Rule 2: the default export must be the resolved `defineAuthorizedHandler` call. */
export function routeSecurityErrors(state: EffectiveState): ValidationError[] {
  return patchedRoutes(state)
    .filter((route) => route.wrapper !== "valid")
    .map((route) =>
      error(
        "route-security",
        route,
        "Every API route must be written with defineAuthorizedHandler.",
        "Wrap the handler in defineAuthorizedHandler (security invariant 1).",
      ),
    );
}

/** Rule 3: `dbTables` must be present; unknown (null) fails closed. */
export function routeDbTablesPresentErrors(state: EffectiveState): ValidationError[] {
  return patchedRoutes(state)
    .filter((route) => route.dbTables === null)
    .map((route) =>
      error(
        "db-tables-present",
        route,
        "Route config must declare dbTables (an empty array when it touches no table).",
        "Add dbTables: [] or the list of tables the handler uses (security invariant 2).",
      ),
    );
}

/**
 * Rule 8: a handler that reads the request input must declare the matching schema — `body`
 * for a JSON body, `form` for a multipart/form-data body (D-053).
 */
export function routeInputErrors(state: EffectiveState): ValidationError[] {
  return patchedRoutes(state).flatMap((route) => {
    const errors: ValidationError[] = [];
    if (route.handlerBodyRead && !route.input.body) {
      errors.push(
        error(
          "route-input-validated",
          route,
          "The handler reads the request body but the route declares no body schema.",
          "Declare body: <ZodSchema> in the defineAuthorizedHandler config for a JSON body (security invariant 3).",
        ),
      );
    }
    if (route.handlerFormRead && !route.input.form) {
      errors.push(
        error(
          "route-input-validated",
          route,
          "The handler reads the multipart form but the route declares no form schema.",
          "Declare form: <ZodSchema> in the defineAuthorizedHandler config for a multipart/form-data upload (security invariant 3).",
        ),
      );
    }
    return errors;
  });
}
