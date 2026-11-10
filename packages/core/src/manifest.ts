import type { SchemaSnapshot } from "@facilis/db";

import type { DbMode, FacilisConfig } from "./config.ts";

/**
 * Manifest contract (SPEC §6.1, §6.2, §7.2, §7.3).
 *
 * Types are declared in core so `@facilis/nitro`, the Studio and the AI layer share one
 * shape; schema snapshot types are re-exported from `@facilis/db` so consumers only ever
 * import the public surface from `@facilis/core` (SPEC §5.1).
 */

export type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  PolicySnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from "@facilis/db";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type BlockCategory = "data" | "form" | "layout" | "auth" | "feedback" | "media" | "other";

/** A registered block's manifest (SPEC §7.2); reserved — no block package ships (D-131). */
export interface ApiHint {
  readonly method: HttpMethod;
  readonly path: string;
  readonly role: "reads" | "writes";
}

export interface BlockManifest {
  readonly name: string;
  readonly version: string;
  readonly category: BlockCategory;
  readonly description: string;
  /** JSON Schema of the block's props. */
  readonly propsSchema: Readonly<Record<string, unknown>>;
  readonly apiHints?: readonly ApiHint[];
  readonly i18nKeys?: readonly string[];
  readonly requiredPermissions?: readonly string[];
  readonly resourceBound?: boolean;
}

/**
 * SPEC §7.3 declares `summary`, while the framework AST pass naturally extracts a route
 * description; both are kept (additive) so neither producer has to drop information.
 */
export interface RouteMeta {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  /** Widened from SPEC §7.3's `string`: an authorized route may require several permissions. */
  readonly permission?: string | readonly string[];
  /** Declared callable from other origins (CORS); absent when the route is same-origin only. */
  readonly crossSite?: boolean;
  /** REQUIRED (SPEC §7.4): an empty array is an explicit "this route does not touch the DB". */
  readonly dbTables: readonly string[];
  /** `"table.column"` references used by the release diff and the entity explorer. */
  readonly dbColumns: readonly string[];
  readonly security: "required" | "optional" | "public" | "unknown";
  /** Source route file, for Studio jump-to. */
  readonly sourceFile?: string;
}

export type LocaleCatalogs = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface ManifestFrameworkVersions {
  readonly coreVersion: string;
  readonly nitroVersion: string;
}

/**
 * SPEC §7.3 shape. Section properties are mutable so producers can assemble a manifest
 * field by field (`?sections=` filtering); the arrays inside stay readonly.
 */
export interface FacilisManifest {
  framework: ManifestFrameworkVersions;
  project: { config: FacilisConfig };
  blocks: readonly BlockManifest[];
  routes: readonly RouteMeta[];
  schema: SchemaSnapshot;
  i18n: {
    defaultLocale: string;
    catalogs: LocaleCatalogs;
  };
}

/** Manifest sections as accepted by `?sections=` (SPEC §6.1). */
export const MANIFEST_SECTIONS = ["config", "blocks", "routes", "schema", "i18n", "meta"] as const;
export type ManifestSection = (typeof MANIFEST_SECTIONS)[number];

export function isManifestSection(value: unknown): value is ManifestSection {
  return MANIFEST_SECTIONS.some((section) => section === value);
}

export interface ManifestWarning {
  /** Machine-readable code, e.g. `"meta-not-static"` (contracts §8); no prose for clients. */
  readonly code: string;
  readonly message: string;
  readonly section?: ManifestSection;
  readonly sourceFile?: string;
}

/** Envelope of `GET /__facilis/manifest` (SPEC §6.2). */
export interface FacilisMetaResponse {
  readonly revision: string;
  readonly generatedAt: string;
  readonly sections: readonly ManifestSection[];
  readonly manifest: Partial<FacilisManifest>;
  readonly warnings: readonly ManifestWarning[];
}

export interface BuildManifestInput {
  readonly config: FacilisConfig;
  /** Supplied by the runtime packages; core must not import its own package.json. */
  readonly coreVersion?: string;
  readonly nitroVersion?: string;
  readonly blocks?: readonly BlockManifest[];
  readonly routes?: readonly RouteMeta[];
  readonly schema?: SchemaSnapshot;
  readonly catalogs?: LocaleCatalogs;
}

const UNKNOWN_VERSION = "0.0.0";

/**
 * Pure assembler: every section defaults to its empty value so a booting project always has
 * a valid manifest. Warnings belong to the response envelope, never to the manifest itself.
 */
export function buildManifest(input: BuildManifestInput): FacilisManifest {
  return {
    framework: {
      coreVersion: input.coreVersion ?? UNKNOWN_VERSION,
      nitroVersion: input.nitroVersion ?? UNKNOWN_VERSION,
    },
    project: { config: input.config },
    blocks: input.blocks ?? [],
    routes: input.routes ?? [],
    schema: input.schema ?? { tables: [] },
    i18n: {
      defaultLocale: input.config.i18n.defaultLocale,
      catalogs: input.catalogs ?? {},
    },
  };
}

/**
 * Compact manifest view for `?format=summary` (SPEC §6.1, §14.1-11): counts and names only,
 * deliberately bounded so it stays well under the 500-token budget.
 */
export interface ManifestSummary {
  readonly framework: ManifestFrameworkVersions;
  readonly project: {
    readonly dbMode: DbMode;
    readonly releaseRef: string;
    readonly defaultLocale: string;
  };
  readonly counts: {
    readonly blocks: number;
    readonly routes: number;
    readonly tables: number;
    readonly columns: number;
    readonly policies: number;
    readonly locales: number;
    readonly permissions: number;
    readonly roles: number;
  };
  /** Sorted identifiers only — no per-route or per-table payloads. */
  readonly blocks: readonly string[];
  readonly tables: readonly string[];
  readonly locales: readonly string[];
}

export function summarizeManifest(manifest: FacilisManifest): ManifestSummary {
  const tables = manifest.schema.tables;
  const config = manifest.project.config;

  return {
    framework: manifest.framework,
    project: {
      dbMode: config.db.mode,
      releaseRef: config.release.ref,
      defaultLocale: manifest.i18n.defaultLocale,
    },
    counts: {
      blocks: manifest.blocks.length,
      routes: manifest.routes.length,
      tables: tables.length,
      columns: tables.reduce((total, table) => total + table.columns.length, 0),
      policies: tables.reduce((total, table) => total + table.policies.length, 0),
      locales: Object.keys(manifest.i18n.catalogs).length,
      permissions: config.auth.permissions.length,
      roles: Object.keys(config.auth.roles).length,
    },
    blocks: manifest.blocks.map((block) => block.name).toSorted(),
    tables: tables.map((table) => table.name).toSorted(),
    locales: Object.keys(manifest.i18n.catalogs).toSorted(),
  };
}
