/**
 * Rule 17 `route-description` (SPEC §9.3, D-129), a warning: the description is source
 * documentation the project graph and the OpenAPI document show, so a missing, over-long or
 * clearly stale one is worth fixing — but it must never stop a patch from applying.
 *
 * "Stale" is deliberately narrow: the text is unchanged while the route's contract changed
 * in the same patch. Only then is the description demonstrably out of date rather than just
 * terse, which a text check cannot tell. A route with an invalid wrapper is skipped because
 * rule 2 already blocks it.
 */

import { ROUTE_DESCRIPTION_MAX_CHARS } from "@facilis.dev/analyze";

import type { EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { RouteFact, ValidationError } from "../types.ts";
import { patchedRoutes } from "./routes-security.ts";

const RULE = "route-description";

function warning(route: RouteFact, message: string, fix_hint: string): ValidationError {
  return {
    rule: RULE,
    severity: "warning",
    file: route.sourceFile,
    message,
    fix_hint,
    line: route.source.line,
  };
}

/** A contract list compared order-insensitively; null (unknown) stays distinct from []. */
function stableList(values: readonly string[] | null): string | null {
  return values === null ? null : [...values].sort().join("\u0000");
}

/**
 * The contract fields D-129 says the description must cover. The lists are sorted because
 * `permission`, `dbTables` and `dbColumns` are sets: reordering them changes no behaviour.
 */
function contractSignature(route: RouteFact): string {
  return JSON.stringify([
    route.wrapper,
    stableList(route.permission),
    stableList(route.dbTables),
    stableList(route.dbColumns),
    route.input.body,
    route.input.form,
    route.input.query,
    route.input.params,
  ]);
}

/** The pre-patch fact of the very same route, matched by file + method + path. */
function prePatchRoute(state: EffectiveState, route: RouteFact): RouteFact | undefined {
  const file = normalizeProjectPath(route.sourceFile);
  return state.before.routes.find(
    (candidate) =>
      normalizeProjectPath(candidate.sourceFile) === file &&
      candidate.method === route.method &&
      candidate.path === route.path,
  );
}

/** Rule 17: every patched route should carry one current English description. */
export function routeDescriptionWarnings(state: EffectiveState): ValidationError[] {
  const warnings: ValidationError[] = [];
  for (const route of patchedRoutes(state)) {
    // Rule 2 reports the wrapper error; a description for a broken route is not actionable.
    if (route.wrapper !== "valid") continue;
    const description = route.description;
    if (description === null || description.trim() === "") {
      warnings.push(
        warning(
          route,
          "Route config must declare a description.",
          "Add a one-sentence description of what the route does, in English, max " +
            ROUTE_DESCRIPTION_MAX_CHARS +
            " characters.",
        ),
      );
      // Without text it cannot be over-long or stale (and the warning above already fires).
      continue;
    }
    if (description.length > ROUTE_DESCRIPTION_MAX_CHARS) {
      warnings.push(
        warning(
          route,
          "The route description is " +
            description.length +
            " characters; keep it to " +
            ROUTE_DESCRIPTION_MAX_CHARS +
            " (about two lines).",
          "Shorten the description to one English sentence of at most " +
            ROUTE_DESCRIPTION_MAX_CHARS +
            " characters.",
        ),
      );
    }
    const previous = prePatchRoute(state, route);
    if (previous === undefined) continue;
    if (previous.description !== description) continue;
    if (contractSignature(previous) === contractSignature(route)) continue;
    warnings.push(
      warning(
        route,
        "The route's contract changed but its description did not, so the description may no longer be accurate.",
        "Update the description to match the route's permission, input schemas, dbTables and dbColumns.",
      ),
    );
  }
  return warnings;
}
