/**
 * The pre-patch project context overlaid with one patch set.
 *
 * Every context-dependent rule reads this state instead of re-deriving the patch: the
 * effective config/schema/locales and the file set are computed once, so a rule cannot
 * accidentally validate against the pre-patch world. Pure and browser-safe.
 */

import { parseConfigSource } from "./config-facts.ts";
import { normalizeProjectPath } from "./paths.ts";
import { maskSource } from "./scan.ts";
import { parseSchemaSource } from "./schema-facts.ts";
import type { ConfigFacts, FilePatch, PatchContext, TableFacts } from "./types.ts";

/** A post-patch source file with its comments masked once. */
export interface PatchedSource {
  path: string;
  content: string;
  masked: string;
}

export interface EffectiveState {
  /** Project-relative files that exist after the patch. */
  files: ReadonlySet<string>;
  /** Project sources after the patch (patched content wins, deletes removed). */
  sources: Readonly<Record<string, string>>;
  beforeConfig: ConfigFacts;
  config: ConfigFacts;
  /** Every table after the patch: manifest facts merged with the effective code schema. */
  schemaTables: readonly TableFacts[];
  beforeSchemaTables: readonly TableFacts[];
  afterSchemaTables: readonly TableFacts[];
  locales: Readonly<Record<string, string>>;
  /** False when a patched locales/en.json is not valid JSON. */
  localesValid: boolean;
  /** Created/updated files, with comments masked, in patch order. */
  patchedSources: readonly PatchedSource[];
  /** Every path the patch touches, and those it deletes. */
  patchedPaths: ReadonlySet<string>;
  deletedPaths: ReadonlySet<string>;
  removedTables: readonly string[];
  removedPermissions: readonly string[];
  migrationsDir: string;
}

export const CONFIG_PATH = "facilis.config.ts";
export const SCHEMA_PATH = "db/schema.ts";
export const LOCALES_PATH = "locales/en.json";

function parseCatalog(text: string): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const catalog: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") catalog[key] = value;
    }
    return catalog;
  } catch {
    return null;
  }
}

function mergeTables(base: readonly TableFacts[], added: readonly TableFacts[]): TableFacts[] {
  const merged = new Map<string, TableFacts>();
  for (const table of base) merged.set(table.name, table);
  for (const table of added) merged.set(table.name, table);
  return [...merged.values()];
}

/** True when the patch creates a SQL migration file in the configured directory. */
export function hasMigrationPatch(patches: readonly FilePatch[], migrationsDir: string): boolean {
  return patches.some(
    (patch) =>
      patch.action === "create" &&
      normalizeProjectPath(patch.path).startsWith(
        normalizeProjectPath(migrationsDir).replace(/\/+$/, "") + "/",
      ) &&
      normalizeProjectPath(patch.path).endsWith(".sql"),
  );
}

/** Overlay the patch set onto the project context. */
export function buildEffectiveState(
  context: PatchContext,
  patches: readonly FilePatch[],
): EffectiveState {
  const patched = new Map<string, string>();
  const deleted = new Set<string>();
  const patchedPaths = new Set<string>();
  for (const patch of patches) {
    const path = normalizeProjectPath(patch.path);
    patchedPaths.add(path);
    if (patch.action === "delete") deleted.add(path);
    else if (typeof patch.content === "string") patched.set(path, patch.content);
  }

  const beforeConfig = context.config;
  const config = patched.has(CONFIG_PATH)
    ? parseConfigSource(patched.get(CONFIG_PATH) ?? "")
    : context.config;

  const beforeSchemaTables = context.schema.tables.filter((table) => table.source === "schema");
  let afterSchemaTables: TableFacts[];
  let extraTables: TableFacts[];
  if (deleted.has(SCHEMA_PATH)) {
    afterSchemaTables = [];
    extraTables = [];
  } else if (patched.has(SCHEMA_PATH)) {
    const parsed = parseSchemaSource(patched.get(SCHEMA_PATH) ?? "", config);
    afterSchemaTables = parsed.filter((table) => table.source === "schema");
    extraTables = parsed.filter((table) => table.source !== "schema");
  } else {
    afterSchemaTables = beforeSchemaTables;
    extraTables = context.schema.tables.filter((table) => table.source === "re-export");
  }
  const beforeNames = new Set(beforeSchemaTables.map((table) => table.name));
  const manifestTables = context.schema.tables.filter(
    (table) => table.source === "manifest" && !beforeNames.has(table.name),
  );
  const afterNames = new Set(afterSchemaTables.map((table) => table.name));

  let locales = context.locales;
  let localesValid = true;
  if (patched.has(LOCALES_PATH)) {
    const catalog = parseCatalog(patched.get(LOCALES_PATH) ?? "");
    if (catalog === null) localesValid = false;
    else locales = catalog;
  }

  const files = new Set(context.files.map(normalizeProjectPath));
  const sources: Record<string, string> = { ...context.sources };
  for (const path of deleted) {
    files.delete(path);
    delete sources[path];
  }
  for (const [path, content] of patched) {
    files.add(path);
    sources[path] = content;
  }

  const patchedSources: PatchedSource[] = [];
  for (const [path, content] of patched) {
    patchedSources.push({ path, content, masked: maskSource(content) });
  }

  return {
    files,
    sources,
    beforeConfig,
    config,
    schemaTables: mergeTables(manifestTables, [...extraTables, ...afterSchemaTables]),
    beforeSchemaTables,
    afterSchemaTables,
    locales,
    localesValid,
    patchedSources,
    patchedPaths,
    deletedPaths: deleted,
    removedTables: [...beforeNames].filter((name) => !afterNames.has(name)),
    removedPermissions: beforeConfig.permissions.filter(
      (permission) => !config.permissions.includes(permission),
    ),
    migrationsDir: normalizeProjectPath(config.migrationsDir),
  };
}
