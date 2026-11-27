/**
 * The declared security surface (D-226, SPEC §8.10).
 *
 * Facilis's standard model is the only green path: an authorized route, a policy-scoped
 * client, Zod input. Everything else a project can do is a capability, and a capability is
 * legitimate only when the code declares it with a reason. This module owns the vocabulary
 * shared by the runtime brand, the analyzer facts and the release export, so the four
 * classes cannot drift between them.
 *
 * No ambient authority: a capability declaration is data attached to the call site, and the
 * runtime brand is a module-private WeakSet. Nothing here is reachable from the request
 * event, so a raw handler cannot forge a declaration by writing to event.context.
 */

/** The four classes of a surface. Only "standard" is green (D-226 decision 1). */
export const SURFACE_CLASSES = ["standard", "declared", "undeclared", "unknown"] as const;

export type SurfaceClass = (typeof SURFACE_CLASSES)[number];

/** The capabilities a project can declare; every one needs a non-empty reason. */
export type SurfaceKind = "raw-route" | "server-extension" | "raw-db" | "raw-sql" | "dynamic-code";

export interface SurfaceDeclaration {
  readonly kind: SurfaceKind;
  /** Why the capability exists; non-empty by construction (assertSurfaceReason). */
  readonly reason: string;
  /** Project-relative file that carries the declaration. */
  readonly file?: string;
  /** One-based line of the declaration call in that file. */
  readonly line?: number;
  /** Optional provenance for a declaration the IDE wrote after the user confirmed it. */
  readonly confirmed?: {
    readonly at: string;
    readonly by: string;
  };
}

/** Thrown when a declaration is malformed; the capability is never silently downgraded. */
export class SurfaceDeclarationError extends Error {
  readonly code = "surface_declaration_invalid";

  constructor(message: string) {
    super(message);
    this.name = "SurfaceDeclarationError";
  }
}

/** A declaration reason is the whole proof: it must say why, not that a capability exists. */
export function assertSurfaceReason(reason: unknown, kind: SurfaceKind): string {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new SurfaceDeclarationError(
      'surface_declaration_invalid: "' + kind + '" requires a non-empty reason.',
    );
  }
  return reason.trim();
}

/** Build a validated declaration; used by the DSL wrappers and by tests. */
export function surfaceDeclaration(
  kind: SurfaceKind,
  reason: unknown,
  meta: { readonly file?: string; readonly line?: number } = {},
): SurfaceDeclaration {
  return {
    kind,
    reason: assertSurfaceReason(reason, kind),
    ...(meta.file === undefined ? {} : { file: meta.file }),
    ...(meta.line === undefined ? {} : { line: meta.line }),
  };
}

/*
 * Runtime brand (D-226 decision 8b). The analyzer proves the static fact; the brand proves
 * that the value a server actually mounted came out of the DSL, not from a hand-written
 * export that only looks like one. The sets are module-private: no request code can mark a
 * handler, and a forged default export stays unbranded at mount time.
 */
const routeHandlers = new WeakSet<object>();
const serverExtensions = new WeakSet<object>();

/** Marks a value as produced by defineAuthorizedHandler/defineRawRoute. */
export function brandRouteHandler<T extends object>(handler: T): T {
  routeHandlers.add(handler);
  return handler;
}

/** True only for a handler produced by the route DSL (never for a lookalike export). */
export function isFacilisRouteHandler(value: unknown): boolean {
  return typeof value === "function" && routeHandlers.has(value);
}

/** Marks a value as produced by defineServerExtension. */
export function brandServerExtension<T extends object>(extension: T): T {
  serverExtensions.add(extension);
  return extension;
}

/** True only for a Nitro plugin/middleware produced by defineServerExtension. */
export function isFacilisServerExtension(value: unknown): boolean {
  return (
    (typeof value === "function" || (typeof value === "object" && value !== null)) &&
    serverExtensions.has(value as object)
  );
}

/** The JSON-safe shape the analyzer emits for one declaration (D-226 §artifact). */
export interface SurfaceDeclarationFact {
  readonly kind: SurfaceKind;
  readonly reason: string;
  readonly file: string;
  readonly line: number;
  readonly confirmed?: {
    readonly at: string;
    readonly by: string;
  };
}
