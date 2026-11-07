import { diagnostic } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { identifierName, literalString, nodeArray } from "../ast/node.ts";
import type { Diagnostic, ConfigFacts } from "../types.ts";
import { nodeRef } from "./schema-dsl.ts";
import { collectTableDrafts, type TableDraft, type TableScan } from "./schema-tables.ts";

/** Merge the tables of `export { users } from "@facilis/auth"` (framework source, recursively). */
export function collectReExportedDrafts(
  graph: ModuleGraph,
  file: ProjectFile,
  config: ConfigFacts,
  seenNames: Set<string>,
  visitedFiles: Set<string>,
): TableScan {
  const drafts: TableDraft[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const statement of nodeArray(file.program, "body")) {
    const hasSource =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportAllDeclaration";
    const specifier = hasSource ? literalString(statement.source) : undefined;
    if (specifier === undefined) continue;
    const targetPath = graph.resolve(file.path, specifier);
    const target = targetPath === null ? undefined : graph.file(targetPath);
    if (target === undefined) {
      diagnostics.push(
        diagnostic(
          "unknown",
          "info",
          'cannot resolve re-exported module "' + specifier + '"',
          nodeRef(file, statement),
        ),
      );
      continue;
    }
    if (visitedFiles.has(target.path)) continue;
    visitedFiles.add(target.path);
    const local = collectTableDrafts(graph, target, config);
    diagnostics.push(...local.diagnostics);
    for (const draft of local.drafts) {
      if (seenNames.has(draft.fact.name)) continue;
      seenNames.add(draft.fact.name);
      drafts.push(draft);
    }
    const nested = collectReExportedDrafts(graph, target, config, seenNames, visitedFiles);
    drafts.push(...nested.drafts);
    diagnostics.push(...nested.diagnostics);
  }

  // The example project imports framework tables and re-exports the local bindings:
  //   import { users } from "@facilis/auth"; export { users };
  // Follow the import, keep only the tables whose binding was re-exported.
  for (const statement of nodeArray(file.program, "body")) {
    if (
      statement.type !== "ExportNamedDeclaration" ||
      literalString(statement.source) !== undefined
    )
      continue;
    for (const item of nodeArray(statement, "specifiers")) {
      if (item.type !== "ExportSpecifier") continue;
      const local = identifierName(item.local);
      if (local === undefined) continue;
      const imported = file.module.imports.find((entry) => entry.local === local);
      if (imported === undefined) continue;
      const targetPath = graph.resolve(file.path, imported.specifier);
      const target = targetPath === null ? undefined : graph.file(targetPath);
      if (target === undefined) {
        diagnostics.push(
          diagnostic(
            "unknown",
            "info",
            'cannot resolve re-exported module "' + imported.specifier + '"',
            nodeRef(file, item),
          ),
        );
        continue;
      }
      if (visitedFiles.has(target.path)) continue;
      visitedFiles.add(target.path);
      const localScan = collectTableDrafts(graph, target, config);
      diagnostics.push(...localScan.diagnostics);
      for (const draft of localScan.drafts) {
        const importedName = imported.imported ?? local;
        if (draft.binding !== importedName && draft.fact.name !== importedName) continue;
        if (seenNames.has(draft.fact.name)) continue;
        seenNames.add(draft.fact.name);
        drafts.push(draft);
      }
      const nested = collectReExportedDrafts(graph, target, config, seenNames, visitedFiles);
      drafts.push(...nested.drafts);
      diagnostics.push(...nested.diagnostics);
    }
  }
  return { drafts, diagnostics };
}
