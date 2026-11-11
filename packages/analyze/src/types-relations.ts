// Route relation-usage and view facts (D-157), split from types.ts so the base fact model
// stays under the 300-line source limit. A fact that cannot be determined is explicit:
// an empty usage is "nothing observed", never "nothing to check".

import type { ElevationKind, SourceRef, UnknownFact } from "./types.ts";

/** A view declared with defineView under db/views/ (D-097/D-098). Not a graph node (D-157). */
export interface ViewFact {
  readonly name: string;
  /** TypeScript binding holding the view, when declared as a const. */
  readonly binding: string | null;
  /** Base tables named by the declaration (metadata only, D-097); [] when absent. */
  readonly tables: readonly string[];
  /** The view's own permission; null keeps the invoker behaviour (D-098). */
  readonly permission: string | null;
  /** null when a declared permission could not be read, so the mode is unknown. */
  readonly access: "invoker" | "definer" | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

/** One relation (table or view) a route reaches through a db client. */
export interface RouteRelationUse {
  readonly name: string;
  /** The use site, so a finding can jump to the expression. */
  readonly source: SourceRef;
}

/** What one audited elevation callback reaches through its elevated db client (D-157). */
export interface RouteElevationUsage {
  readonly kind: ElevationKind;
  /** The ctx.sudo / ctx.system call site. */
  readonly source: SourceRef;
  /** The elevation's own `tables` option; [] when unknown. */
  readonly tables: readonly string[];
  readonly used: readonly RouteRelationUse[];
  readonly unresolved: readonly SourceRef[];
  /** The elevation's `tables` option is missing or not statically readable. */
  readonly tablesUnknown: boolean;
  /** The elevated client reached a callee outside the project graph. */
  readonly opaque: boolean;
}

/** Static db usage of one route handler, following project-local helper calls (D-157). */
export interface RouteRelationsFact {
  /** Relations reached through ctx.db outside elevations, deduplicated by name. */
  readonly used: readonly RouteRelationUse[];
  /** Dynamic/unresolvable relation expressions, and uses the pass could not inspect. */
  readonly unresolved: readonly SourceRef[];
  /** `db.execute(...)` call sites; legal only with rawSql: true. */
  readonly rawSql: readonly SourceRef[];
  /** A project-external callee received the route's db client, so usage is incomplete. */
  readonly opaque: boolean;
  readonly elevations: readonly RouteElevationUsage[];
}

/** Usage of a route the pass cannot scan (invalid wrapper): explicitly empty, not unknown. */
export const EMPTY_ROUTE_RELATIONS: RouteRelationsFact = {
  used: [],
  unresolved: [],
  rawSql: [],
  opaque: false,
  elevations: [],
};
