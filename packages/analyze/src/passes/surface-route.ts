/**
 * Route capability classification (D-226).
 *
 * The wrapper decides the base class: an authorized route is standard, a raw route is
 * declared only when its reason/auth are valid. Declarations inside a handler (rawSql,
 * ctx.rawDb) promote a standard route to declared; a malformed or reasonless use demotes it
 * to undeclared. Unreadable facts become unknown, and unknown is never green.
 */
import { error } from "../diagnostics.ts";
import type { SourceRef, UnknownFact } from "../types.ts";
import type { RawDbCallFact, RouteSurfaceFact, SurfaceDeclarationFact } from "../types-surface.ts";

export interface RouteSurfaceInput {
  readonly raw: boolean;
  readonly rawReason: string | null;
  readonly rawDeclared: boolean;
  readonly rawConfirmed?: { readonly at: string; readonly by: string };
  readonly rawSql: boolean | null;
  readonly rawSqlReason: string | null;
  readonly rawDb: readonly RawDbCallFact[];
  /** The handler body could not be inspected (imported handler, ctx passed to a helper). */
  readonly opaqueHandler: boolean;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export interface RouteSurfaceResult {
  readonly surface: RouteSurfaceFact;
  readonly diagnostics: ReturnType<typeof error>[];
}

export function routeSurface(input: RouteSurfaceInput): RouteSurfaceResult {
  const declarations: SurfaceDeclarationFact[] = [];
  const diagnostics: RouteSurfaceResult["diagnostics"] = [];
  let undeclared = false;
  let unknown = false;

  if (input.raw) {
    if (input.rawDeclared && input.rawReason !== null) {
      declarations.push({
        kind: "raw-route",
        reason: input.rawReason,
        source: input.source,
        ...(input.rawConfirmed === undefined ? {} : { confirmed: input.rawConfirmed }),
      });
    } else {
      undeclared = true;
    }
  }

  if (input.rawSql === true) {
    if (input.rawSqlReason === null) {
      undeclared = true;
      diagnostics.push(
        error(
          "surface-undeclared",
          'rawSql must declare why: use rawSql: { reason: "..." } (D-226)',
          input.source,
        ),
      );
    } else {
      declarations.push({ kind: "raw-sql", reason: input.rawSqlReason, source: input.source });
    }
  } else if (input.rawSql === null) {
    unknown = true;
  }

  for (const call of input.rawDb) {
    if (call.reason === null) {
      undeclared = true;
      diagnostics.push(
        error(
          "surface-undeclared",
          "ctx.rawDb requires a non-empty reason at the call site (D-226)",
          call.source,
        ),
      );
      continue;
    }
    declarations.push({ kind: "raw-db", reason: call.reason, source: call.source });
  }

  if (input.opaqueHandler) {
    unknown = true;
    diagnostics.push(
      error(
        "surface-unknown",
        "the handler body is not statically analysable; inline it or move the ctx escape into a declared raw route (D-226)",
        input.source,
      ),
    );
  }
  if (input.unknown.length > 0) unknown = true;

  const surface: RouteSurfaceFact = {
    class: unknown
      ? "unknown"
      : undeclared
        ? "undeclared"
        : declarations.length > 0
          ? "declared"
          : "standard",
    declarations,
    source: input.source,
    unknown: input.unknown,
    rawSqlReason: input.rawSqlReason,
    rawDb: input.rawDb,
  };
  return { surface, diagnostics };
}
