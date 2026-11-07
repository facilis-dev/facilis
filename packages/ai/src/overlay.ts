/**
 * The pre-patch project context overlaid with one patch set.
 *
 * After D-092 this is fact-based: the caller supplies the effective (post-patch) Analysis
 * and the pre-patch one, so the overlay only projects them plus the patch-shaped
 * bookkeeping the rules need (file set, patched paths, removed facts). It never parses
 * project sources; the one JSON read is the patched locale catalogue, because rule 13 must
 * tell "no keys" from "broken catalogue". Pure and browser-safe.
 */

import type { Analysis, ConfigFacts, FileFacts, TableFact } from "@facilis/analyze";

import { LOCALES_PATH, normalizeProjectPath, SCHEMA_PATH } from "./paths.ts";
import type { FilePatch, PatchContext } from "./types.ts";

export { CONFIG_PATH, LOCALES_PATH, SCHEMA_PATH } from "./paths.ts";

export interface EffectiveState {
  /** Project-relative files that exist after the patch. */
  files: ReadonlySet<string>;
  /** Every path the patch touches, and those it deletes. */
  patchedPaths: ReadonlySet<string>;
  deletedPaths: ReadonlySet<string>;
  /** Effective analysis + the pre-patch one, for inverse edits. */
  analysis: Analysis;
  before: Analysis;
  /** Module facts of the created/updated files (from the effective analysis). */
  patchedFileFacts: readonly FileFacts[];
  /** Effective config after the patch (analyzer facts). */
  config: ConfigFacts;
  /** Every effective table, including framework tables re-exported into the schema. */
  schemaTables: readonly TableFact[];
  /** Tables declared in the code schema before and after the patch (no re-exports). */
  beforeSchemaTables: readonly TableFact[];
  afterSchemaTables: readonly TableFact[];
  locales: Readonly<Record<string, string>>;
  /** False when a patched locales/en.json is not a valid JSON catalogue. */
  localesValid: boolean;
  migrationsDir: string;
  removedTables: readonly string[];
  removedPermissions: readonly string[];
}

function parseCatalog(content: string): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(content);
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

/** A table the project declares in its own schema file (not a framework re-export). */
function isSchemaTable(table: TableFact): boolean {
  return normalizeProjectPath(table.source.file) === SCHEMA_PATH;
}

/** True when the patch creates a SQL migration file in the configured directory. */
export function hasMigrationPatch(patches: readonly FilePatch[], migrationsDir: string): boolean {
  const directory = normalizeProjectPath(migrationsDir).replace(/\/+$/, "");
  return patches.some(
    (patch) =>
      patch.action === "create" &&
      normalizeProjectPath(patch.path).startsWith(directory + "/") &&
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

  const analysis = context.analysis;
  const before = context.before;
  const config = analysis.config;
  const beforeSchemaTables = before.tables.filter(isSchemaTable);
  const afterSchemaTables = analysis.tables.filter(isSchemaTable);
  const afterNames = new Set(afterSchemaTables.map((table) => table.name));
  const beforeNames = new Set(beforeSchemaTables.map((table) => table.name));

  let locales = context.locales;
  let localesValid = true;
  const catalogContent = patched.get(LOCALES_PATH);
  if (catalogContent !== undefined) {
    const catalog = parseCatalog(catalogContent);
    if (catalog === null) localesValid = false;
    else locales = catalog;
  }

  const files = new Set(context.files.map(normalizeProjectPath));
  for (const path of deleted) files.delete(path);
  for (const path of patched.keys()) files.add(path);

  return {
    files,
    patchedPaths,
    deletedPaths: deleted,
    analysis,
    before,
    patchedFileFacts: analysis.fileFacts.filter((facts) =>
      patchedPaths.has(normalizeProjectPath(facts.path)),
    ),
    config,
    schemaTables: analysis.tables,
    beforeSchemaTables,
    afterSchemaTables,
    locales,
    localesValid,
    migrationsDir: normalizeProjectPath(config.migrationsDir),
    removedTables: [...beforeNames].filter((name) => !afterNames.has(name)),
    removedPermissions: before.config.permissions.filter(
      (permission) => !config.permissions.includes(permission),
    ),
  };
}
