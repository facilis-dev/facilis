/**
 * Defensive readers for the `/__facilis/manifest` payload (SPEC §6.2, §7.3).
 *
 * The manifest is data from a running app, not a trusted compiler output, so every field
 * is narrowed and an unexpected shape simply yields fewer facts. Rules that need a fact
 * the manifest cannot supply fall back to the source of truth (the code) or report the
 * rule only when they can verify it.
 */

import { emptyConfigFacts } from "./config-facts.ts";
import type { BlockFacts, ConfigFacts, RouteFacts, TableFacts } from "./types.ts";

export interface ManifestFacts {
  config: ConfigFacts | null;
  tables: TableFacts[];
  blocks: BlockFacts[];
  routes: RouteFacts[];
  locales: Record<string, string>;
  defaultLocale: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function accessList(value: unknown): string[] {
  if (typeof value === "string") return value.length > 0 ? [value] : [];
  return stringArray(value);
}

function normalized(value: string): string {
  return value.replace(/_/g, "").toLowerCase();
}

function factsFromConfig(value: unknown): ConfigFacts | null {
  if (!isRecord(value)) return null;
  const auth = isRecord(value.auth) ? value.auth : null;
  const db = isRecord(value.db) ? value.db : {};
  const i18n = isRecord(value.i18n) ? value.i18n : {};
  const blocks = isRecord(value.blocks) ? value.blocks : {};
  const roles: Record<string, readonly string[]> = {};
  if (auth !== null && isRecord(auth.roles)) {
    for (const [role, permissions] of Object.entries(auth.roles)) {
      roles[role] = stringArray(permissions);
    }
  }
  const tenantColumns = stringArray(db.tenantColumns);
  const ownerColumns = stringArray(db.ownerColumns);
  return emptyConfigFacts({
    parsed: true,
    hasAuth: auth !== null,
    permissions: auth === null ? [] : stringArray(auth.permissions),
    roles,
    defaultRole: auth !== null && typeof auth.defaultRole === "string" ? auth.defaultRole : null,
    defaultLocale: typeof i18n.defaultLocale === "string" ? i18n.defaultLocale : null,
    locales: stringArray(i18n.locales),
    blocksPackages: stringArray(blocks.packages),
    migrationsDir: typeof db.migrationsDir === "string" ? db.migrationsDir : "db/migrations",
    ...(tenantColumns.length > 0 ? { tenantColumns } : {}),
    ...(ownerColumns.length > 0 ? { ownerColumns } : {}),
  });
}

function factsFromTable(value: unknown): TableFacts | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const columns = Array.isArray(value.columns)
    ? value.columns.flatMap((column) =>
        isRecord(column) && typeof column.name === "string" ? [column.name] : [],
      )
    : [];
  const policies = Array.isArray(value.policies)
    ? value.policies.flatMap((policy) =>
        isRecord(policy) && typeof policy.name === "string" ? [policy.name] : [],
      )
    : [];
  const scoped =
    isRecord(value.scopeColumn) ||
    columns.some((column) => /^(?:tenant|owner)[_-]?id$/i.test(column)) ||
    columns.some((column) => ["tenantid", "ownerid", "userid"].includes(normalized(column)));
  return {
    name: value.name,
    columns,
    rlsEnabled: value.rlsEnabled === true,
    policies,
    scoped,
    source: "manifest",
  };
}

function factsFromRoute(value: unknown): RouteFacts | null {
  if (!isRecord(value)) return null;
  return {
    method: typeof value.method === "string" ? value.method : null,
    path: typeof value.path === "string" ? value.path : null,
    permissions: accessList(value.permission),
    dbTables: stringArray(value.dbTables),
    dbColumns: stringArray(value.dbColumns),
    sourceFile: typeof value.sourceFile === "string" ? value.sourceFile : null,
  };
}

function factsFromBlocks(value: unknown): BlockFacts[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.name === "string" ? [{ name: entry.name }] : [],
  );
}

function factsFromCatalog(value: unknown, defaultLocale: string | null): Record<string, string> {
  if (!isRecord(value)) return {};
  const locale = defaultLocale !== null && isRecord(value[defaultLocale]) ? defaultLocale : "en";
  const catalog = value[locale];
  if (!isRecord(catalog)) return {};
  const strings: Record<string, string> = {};
  for (const [key, text] of Object.entries(catalog)) {
    if (typeof text === "string") strings[key] = text;
  }
  return strings;
}

/** Read whatever the manifest is allowed to contribute; a broken payload yields zero facts. */
export function factsFromManifest(manifest: unknown): ManifestFacts {
  const root = isRecord(manifest) ? manifest : {};
  const project = isRecord(root.project) ? root.project : {};
  const schema = isRecord(root.schema) ? root.schema : {};
  const i18n = isRecord(root.i18n) ? root.i18n : {};
  const tables = Array.isArray(schema.tables)
    ? schema.tables.flatMap((table) => {
        const parsed = factsFromTable(table);
        return parsed === null ? [] : [parsed];
      })
    : [];
  const routes = Array.isArray(root.routes)
    ? root.routes.flatMap((route) => {
        const parsed = factsFromRoute(route);
        return parsed === null ? [] : [parsed];
      })
    : [];
  const defaultLocale = typeof i18n.defaultLocale === "string" ? i18n.defaultLocale : null;
  return {
    config: factsFromConfig(project.config),
    tables,
    blocks: factsFromBlocks(root.blocks),
    routes,
    locales: factsFromCatalog(i18n.catalogs, defaultLocale),
    defaultLocale,
  };
}
