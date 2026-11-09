/**
 * Route description rules (D-129).
 *
 * The description is source documentation: one English sentence stored in the
 * defineAuthorizedHandler config, shown under the route node and in the OpenAPI document.
 * Two lines is its useful maximum, so the analyzer reports a warning when it runs long.
 * The patch validator imports the same limit, so the AI and the user see one number.
 */

import { warning } from "../diagnostics.ts";
import type { Diagnostic, SourceRef } from "../types.ts";

/** About two lines in the route definition and in the graph card. */
export const ROUTE_DESCRIPTION_MAX_CHARS = 120;

/** A warning when the description exceed the two-line budget; nothing to report otherwise. */
export function descriptionDiagnostics(
  description: string | null,
  source: SourceRef | null,
): readonly Diagnostic[] {
  if (description === null || description.length <= ROUTE_DESCRIPTION_MAX_CHARS) return [];
  return [
    warning(
      "route-description-length",
      "description is " +
        description.length +
        " characters; keep it to " +
        ROUTE_DESCRIPTION_MAX_CHARS +
        " (about two lines)",
      source,
    ),
  ];
}
