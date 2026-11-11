import type { RouteRelationsFact, ViewFact } from "./types-relations.ts";
import type { ProjectGraph } from "./types-graph.ts";

/**
 * Fact model of the AST analyzer (docs/findings/ast-dsl-contract.md).
 *
 * Facts are parser-independent and always carry their source. A fact that cannot be
 * determined is represented explicitly (null or an unknown entry), never as an empty value:
 * in particular "dbTables unknown" (null) is not "no DB tables" ([]).
 */

export interface SourceRef {
  readonly file: string;
  readonly line: number;
}

export interface UnknownFact {
  readonly code: string;
  readonly reason: string;
  readonly source: SourceRef;
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly source: SourceRef | null;
}

export interface LocaleCatalogs {
  readonly [locale: string]: Readonly<Record<string, string>>;
}

// ── config ──────────────────────────────────────────────────────────────────────────

export interface ConfigFacts {
  readonly parsed: boolean;
  readonly source: SourceRef | null;
  readonly permissions: readonly string[];
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly defaultRole: string | null;
  readonly defaultLocale: string | null;
  readonly locales: readonly string[];
  readonly migrationsDir: string;
  readonly tenantColumns: readonly string[];
  readonly ownerColumns: readonly string[];
  readonly unknown: readonly UnknownFact[];
}

// ── schema ──────────────────────────────────────────────────────────────────────────

export type ColumnDefaultKind = "literal" | "now" | "random" | "unknown";

export interface ColumnDefaultFact {
  readonly kind: ColumnDefaultKind;
  readonly value: string | null;
}

export interface ForeignKeyFact {
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete: string | null;
  readonly onUpdate: string | null;
  readonly source: SourceRef;
}

export interface ColumnFact {
  /** Drizzle property key in the table object (the dbColumns domain). */
  readonly property: string;
  /** SQL column name (first literal argument of the builder, or the property key). */
  readonly name: string;
  readonly builder: string;
  /** Display type derived from the builder and its arguments. */
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly default: ColumnDefaultFact | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export type PolicyCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";

export interface PolicyFact {
  readonly name: string;
  readonly command: PolicyCommand;
  readonly restrictive: boolean;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export interface ScopeFact {
  readonly column: string;
  readonly kind: "tenant" | "owner";
}

export interface TableFact {
  readonly name: string;
  /** TypeScript binding holding the table, when declared as a const. */
  readonly binding: string | null;
  readonly columns: readonly ColumnFact[];
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly ForeignKeyFact[];
  readonly policies: readonly PolicyFact[];
  readonly rlsEnabled: boolean;
  readonly scope: ScopeFact | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export interface RelationFact {
  readonly from: string;
  readonly to: string;
  readonly cardinality: "one" | "many";
  readonly fields: readonly string[];
  readonly references: readonly string[];
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

// ── routes ─────────────────────────────────────────────────────────────────────────

export type HttpMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE" | "CONNECT" | "ALL";

export type WrapperState = "valid" | "invalid" | "unknown";

export interface RouteInputFact {
  readonly body: boolean;
  /** A multipart/form-data schema (D-053); mutually exclusive with `body`. */
  readonly form: boolean;
  readonly query: boolean;
  readonly params: boolean;
}

export type ElevationKind = "sudo" | "system";

/** One audited elevation call in a route handler (D-099): `ctx.sudo` / `ctx.system`. */
export interface ElevationFact {
  readonly kind: ElevationKind;
  /** Tables passed to the elevation; [] when the array cannot be read statically. */
  readonly tables: readonly string[];
  /** The audit operation label, when statically readable. */
  readonly operation: string | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export interface RouteFact {
  readonly method: HttpMethod;
  readonly path: string;
  readonly sourceFile: string;
  readonly source: SourceRef;
  readonly wrapper: WrapperState;
  /** null = unknown; [] = explicitly public. */
  readonly permission: readonly string[] | null;
  /**
   * True when the wrapper declares the route callable from another origin; false when absent;
   * null when the declaration cannot be read statically (a cross-origin route is never assumed).
   */
  readonly crossSite: boolean | null;
  /** null = unknown; [] = explicitly no DB. */
  readonly dbTables: readonly string[] | null;
  /** null = unknown; [] = explicitly no columns. */
  readonly dbColumns: readonly string[] | null;
  /** rawSql: true allows `db.execute` (D-157); false when absent; null when unreadable. */
  readonly rawSql: boolean | null;
  /** Static db usage of the handler, project-local helper calls followed (D-157). */
  readonly relations: RouteRelationsFact;
  readonly description: string | null;
  readonly input: RouteInputFact;
  /** True when the handler body reads the request body (SPEC §9.3 rule 8). */
  readonly handlerBodyRead: boolean;
  /** True when the handler body reads the multipart form (SPEC §9.3 rule 8, D-053). */
  readonly handlerFormRead: boolean;
  /** Audited elevation calls in the handler, in source order. */
  readonly elevations: readonly ElevationFact[];
  readonly unknown: readonly UnknownFact[];
}

// ── per-file module facts ──────────────────────────────────────────────────────────

export type ImportKind =
  "named" | "default" | "namespace" | "side-effect" | "export-from" | "dynamic" | "require";

/** One module reference of a source file: static import, re-export, dynamic import or require. */
export interface ImportFact {
  readonly specifier: string;
  readonly kind: ImportKind;
  /** Local binding the reference introduces; null for side-effect/re-export/dynamic forms. */
  readonly local: string | null;
  /** Imported name for named imports ("default" for a default import); null otherwise. */
  readonly imported: string | null;
  readonly source: SourceRef;
}

/** One literal `t("key")` call; interpolated keys are skipped because they are not static. */
export interface TranslationCallFact {
  readonly key: string;
  readonly source: SourceRef;
}

/** One call to a bare identifier (`drizzle(...)`, `t(...)`): enough for the security rules. */
export interface CallFact {
  readonly name: string;
  readonly source: SourceRef;
}

export interface FileFacts {
  /** Project-relative path of the parsed source file. */
  readonly path: string;
  readonly imports: readonly ImportFact[];
  readonly translationCalls: readonly TranslationCallFact[];
  readonly calls: readonly CallFact[];
}

// ── pages / client consumers ───────────────────────────────────────────────────────

export type PageKind = "page" | "component" | "lib" | "other";

export type PathKind = "literal" | "concat" | "template" | "builder" | "dynamic" | "unknown";

export interface RouteCallFact {
  readonly expression: string;
  readonly kind: PathKind;
  readonly staticPrefix: string | null;
  readonly matchedRouteIds: readonly string[];
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

export interface PageFact {
  readonly path: string;
  readonly kind: PageKind;
  readonly calls: readonly RouteCallFact[];
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

// ── graph ──────────────────────────────────────────────────────────────────────────
// The graph-facing shapes live in types-graph.ts (the 300-line split); they are re-exported
// here so every existing `from "./types.ts"` import keeps working.

export type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeData,
  GraphNodeKind,
  PageLink,
  PageNodeData,
  PagePreview,
  PagePreviewNode,
  ProjectGraph,
  RouteNodeData,
  ScreenFacts,
  TableNodeData,
} from "./types-graph.ts";
export type {
  RouteElevationUsage,
  RouteRelationUse,
  RouteRelationsFact,
  ViewFact,
} from "./types-relations.ts";

// ── analysis ───────────────────────────────────────────────────────────────────────

export interface Analysis {
  readonly revision: string;
  readonly files: readonly string[];
  readonly config: ConfigFacts;
  readonly routes: readonly RouteFact[];
  readonly tables: readonly TableFact[];
  readonly relations: readonly RelationFact[];
  /** Declarative views (D-157); facts only — views stay out of the project graph. */
  readonly views: readonly ViewFact[];
  readonly pages: readonly PageFact[];
  /** Module facts for every parsed source file, in path order. */
  readonly fileFacts: readonly FileFacts[];
  readonly locales: LocaleCatalogs;
  readonly diagnostics: readonly Diagnostic[];
  readonly graph: ProjectGraph;
}
