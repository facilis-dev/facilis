import type { SourceRef, UnknownFact } from "./types.ts";

/**
 * The declared-surface fact model (D-226).
 *
 * Route facts carry their own surface; extensions, forbidden imports and dynamic code are
 * project-level facts because they are not routes. Every fact records why it is what it is:
 * a declaration has a reason, an unknown has an UnknownFact, and an undeclared site points
 * at the line that would have to change. The release export is a projection of THIS model,
 * so the IDE and the security review cannot disagree.
 */

export const SURFACE_CLASSES = ["standard", "declared", "undeclared", "unknown"] as const;
export type SurfaceClass = (typeof SURFACE_CLASSES)[number];

export type SurfaceKind = "raw-route" | "server-extension" | "raw-db" | "raw-sql" | "dynamic-code";

export interface SurfaceDeclarationFact {
  readonly kind: SurfaceKind;
  readonly reason: string;
  readonly source: SourceRef;
  /** Optional provenance for a declaration the IDE wrote after user confirmation. */
  readonly confirmed?: {
    readonly at: string;
    readonly by: string;
  };
}

/** One capability site: its class, the declarations that justify it, and its unknowns. */
export interface SurfaceFact {
  readonly class: SurfaceClass;
  readonly declarations: readonly SurfaceDeclarationFact[];
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

/** One `ctx.rawDb({ reason })` call in a handler. */
export interface RawDbCallFact {
  /** null when the reason is not a non-empty literal (undeclared, never guessed). */
  readonly reason: string | null;
  readonly source: SourceRef;
}

export interface RouteSurfaceFact extends SurfaceFact {
  /** Why `db.execute` is allowed; null when rawSql is absent/false. */
  readonly rawSqlReason: string | null;
  readonly rawDb: readonly RawDbCallFact[];
}

export type ServerExtensionKind = "plugin" | "middleware" | "module" | "task";

/** A project file under server/plugins, server/middleware, server/modules or server/tasks. */
export interface ServerExtensionFact {
  readonly file: string;
  readonly kind: ServerExtensionKind;
  readonly surface: SurfaceFact;
}

/** An import that bypasses the db package's declarative API (D-226 decision 10). */
export interface ForbiddenImportFact {
  readonly file: string;
  readonly specifier: string;
  readonly imported: string;
  readonly source: SourceRef;
}

export type DynamicCodeForm = "eval" | "new-function" | "computed-import";

/** Dynamic code: declared by a marker comment or blocked (D-226 decision 7). */
export interface DynamicCodeFact {
  readonly file: string;
  readonly form: DynamicCodeForm;
  readonly surface: SurfaceFact;
}

export interface SurfaceSummary {
  readonly standard: number;
  readonly declared: number;
  readonly undeclared: number;
  readonly unknown: number;
}

export interface SecuritySurfaceFacts {
  readonly extensions: readonly ServerExtensionFact[];
  readonly forbiddenImports: readonly ForbiddenImportFact[];
  readonly dynamicCode: readonly DynamicCodeFact[];
  readonly unknown: readonly UnknownFact[];
  readonly summary: SurfaceSummary;
}
