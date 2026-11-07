import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { ConfigFacts, Diagnostic, RelationFact, TableFact } from "../types.ts";
import { isSchemaFile } from "./schema-dsl.ts";
import { buildTableLookup, finalizeTables } from "./schema-foreign-keys.ts";
import { collectTableDrafts, type TableDraft } from "./schema-tables.ts";
import { collectReExportedDrafts } from "./schema-re-exports.ts";
import { buildRelationFacts } from "./schema-relations.ts";

export interface SchemaResult {
  readonly tables: readonly TableFact[];
  readonly relations: readonly RelationFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function schemaFiles(graph: ModuleGraph): ProjectFile[] {
  return [...graph.files.values()]
    .filter((file) => isSchemaFile(graph, file.path))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

/** Tables declared twice (invalid TS, but analyzable) keep the first declaration. */
function dedupeDrafts(drafts: readonly TableDraft[]): TableDraft[] {
  const seen = new Set<string>();
  const out: TableDraft[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.fact.name)) continue;
    seen.add(draft.fact.name);
    out.push(draft);
  }
  return out;
}

/** Interpret the Drizzle DSL under `db/**`, including framework tables reached by re-export. */
export function buildSchemaFacts(graph: ModuleGraph, config: ConfigFacts): SchemaResult {
  const files = schemaFiles(graph);
  const collected: TableDraft[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const scan = collectTableDrafts(graph, file, config);
    collected.push(...scan.drafts);
    diagnostics.push(...scan.diagnostics);
  }

  const seenNames = new Set(collected.map((draft) => draft.fact.name));
  const visitedFiles = new Set(files.map((file) => file.path));
  for (const file of files) {
    const scan = collectReExportedDrafts(graph, file, config, seenNames, visitedFiles);
    collected.push(...scan.drafts);
    diagnostics.push(...scan.diagnostics);
  }

  const drafts = dedupeDrafts(collected);
  const lookup = buildTableLookup(drafts);
  const finalized = finalizeTables(graph, drafts, lookup);
  diagnostics.push(...finalized.diagnostics);
  const relations = buildRelationFacts(graph, files, lookup);
  diagnostics.push(...relations.diagnostics);
  return { tables: finalized.tables, relations: relations.relations, diagnostics };
}
