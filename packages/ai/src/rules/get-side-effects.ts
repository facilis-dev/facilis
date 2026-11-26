/**
 * Rule 21 `get-side-effect-free` (SPEC §8.6, D-212): a GET route must be side-effect free.
 *
 * SameSite=Lax sends the session cookie on a cross-site top-level GET navigation, so a
 * state-changing GET is CSRF-able even with the origin gate. The rule reads the effective
 * post-patch Analysis' relation-usage facts (the route-relations walk, D-157): proven write
 * sites are errors; a handler body the walk cannot fully inspect is a warning, never a
 * guessed error. It covers every effective GET-like route, not only the patched ones, and
 * shares the analyzer's pinned framework exemption list (the SSO GET/ACS pair, D-120).
 */

import { isGetLikeMethod, routeGetSideEffects } from "@facilis.dev/analyze";

import type { EffectiveState } from "../overlay.ts";
import type { ValidationError } from "../types.ts";

const RULE = "get-side-effect-free";

function finding(
  severity: "error" | "warning",
  file: string,
  message: string,
  fix_hint: string,
  line?: number,
): ValidationError {
  return { rule: RULE, severity, file, message, fix_hint, ...(line === undefined ? {} : { line }) };
}

export interface GetSideEffectFreeFindings {
  readonly errors: ValidationError[];
  readonly warnings: ValidationError[];
}

/** Rule 21 over the effective analysis (SPEC §8.6, D-212). */
export function getSideEffectFreeFindings(state: EffectiveState): GetSideEffectFreeFindings {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  for (const route of state.analysis.routes) {
    if (!isGetLikeMethod(route.method)) continue;
    // A hand-built analysis may predate the usage facts (IDE snapshots): no facts, no check.
    if (route.wrapper !== "valid" || route.relations === undefined) continue;
    const { writes, unknown, exempt } = routeGetSideEffects(route);
    if (exempt) continue;
    for (const site of writes) {
      errors.push(
        finding(
          "error",
          site.file,
          "A GET route must be side-effect free: this write is reachable from a cross-site top-level navigation (SameSite=Lax).",
          "Move the write to a POST/PUT/PATCH/DELETE handler; GET stays read-only (SPEC §8.6, D-212).",
          site.line,
        ),
      );
    }
    if (writes.length === 0 && unknown) {
      warnings.push(
        finding(
          "warning",
          route.sourceFile,
          "The GET handler's side effects cannot be fully inspected (opaque body).",
          "Make the handler body statically inspectable, or confirm the GET is read-only (SPEC §8.6).",
          route.source.line,
        ),
      );
    }
  }
  return { errors, warnings };
}
