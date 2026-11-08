/**
 * `fileLinks(parent, { table, column })` -> the synthetic link table it generates (D-053).
 *
 * The call is framework DSL rather than a `pgTable(...)` literal, so the table pass cannot
 * see the link table it returns. The options come from the static subset and the parent
 * table from the declaring file's own drafts; a value the interpreter cannot read becomes an
 * explicit unknown instead of aborting the pass.
 */

import { callArguments, identifierName, unwrapExpression, type AstNode } from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { StaticContext } from "../static-eval.ts";
import type { Diagnostic, SourceRef, TableFact, UnknownFact } from "../types.ts";
import { optionsOf } from "./schema-column-types.ts";
import type { ColumnReference } from "./schema-columns.ts";
import {
  createDslResolver,
  nodeRef,
  schemaDiagnostics,
  schemaUnknown,
  topLevelDeclarators,
} from "./schema-dsl.ts";
import {
  FACILIS_FILES_BINDING,
  facilisFilesDraft,
  linkColumns,
  linkPolicies,
} from "./schema-file-links-ddl.ts";
import type { TableDraft } from "./schema-tables.ts";

const DB_PACKAGE = "facilis-db";
const FILE_LINKS = "fileLinks";
const DEFAULT_PARENT_COLUMN = "parent_id";

export interface FileLinkScan {
  readonly drafts: readonly TableDraft[];
  readonly diagnostics: readonly Diagnostic[];
  /** Lookup-only targets of the generated FKs; see `facilisFilesDraft`. */
  readonly externalTables: readonly TableDraft[];
}

interface LinkOptions {
  /** null when the name is not a static non-empty string. */
  readonly table: string | null;
  readonly parentColumn: string;
  readonly unknowns: readonly UnknownFact[];
}

function readOptions(
  call: AstNode,
  binding: string | null,
  context: StaticContext,
  source: SourceRef,
): LinkOptions {
  const label = binding ?? "unknown";
  const options = optionsOf(callArguments(call)[1], context);
  const unknowns: UnknownFact[] = [];
  if (options === null) {
    unknowns.push(
      schemaUnknown('fileLinks options of "' + label + '" are not a static object', source),
    );
    return { table: null, parentColumn: DEFAULT_PARENT_COLUMN, unknowns };
  }
  const rawTable = options["table"];
  let table: string | null = null;
  if (typeof rawTable === "string" && rawTable.length > 0) {
    table = rawTable;
  } else {
    unknowns.push(
      schemaUnknown('fileLinks table name of "' + label + '" is not a static string', source),
    );
  }
  const rawColumn = options["column"];
  let parentColumn = DEFAULT_PARENT_COLUMN;
  if (rawColumn !== undefined) {
    if (typeof rawColumn === "string" && rawColumn.length > 0) {
      parentColumn = rawColumn;
    } else {
      unknowns.push(
        schemaUnknown('fileLinks column name of "' + label + '" is not a static string', source),
      );
    }
  }
  return { table, parentColumn, unknowns };
}

interface ParentTarget {
  readonly binding: string;
  readonly property: string;
}

function readParent(
  call: AstNode,
  drafts: readonly TableDraft[],
  binding: string | null,
  source: SourceRef,
): { target: ParentTarget | null; unknowns: readonly UnknownFact[] } {
  const label = binding ?? "unknown";
  const parentNode = unwrapExpression(callArguments(call)[0]);
  const parentBinding = parentNode?.type === "Identifier" ? identifierName(parentNode) : undefined;
  if (parentBinding === undefined) {
    return {
      target: null,
      unknowns: [schemaUnknown('fileLinks parent of "' + label + '" is not an identifier', source)],
    };
  }
  const draft = drafts.find((entry) => entry.binding === parentBinding);
  if (draft === undefined) {
    return {
      target: null,
      unknowns: [
        schemaUnknown(
          'fileLinks parent "' + parentBinding + '" is not a table declared in this file',
          source,
        ),
      ],
    };
  }
  const key = draft.fact.primaryKey[0];
  if (draft.fact.primaryKey.length !== 1 || key === undefined) {
    return {
      target: null,
      unknowns: [
        schemaUnknown(
          'fileLinks parent "' + parentBinding + '" needs a single-column primary key',
          source,
        ),
      ],
    };
  }
  return { target: { binding: parentBinding, property: key }, unknowns: [] };
}

function buildLinkDraft(input: {
  readonly call: AstNode;
  readonly binding: string | null;
  readonly drafts: readonly TableDraft[];
  readonly context: StaticContext;
  readonly source: SourceRef;
}): { draft: TableDraft; external: TableDraft; unknowns: readonly UnknownFact[] } {
  const { call, binding, drafts, context, source } = input;
  const options = readOptions(call, binding, context, source);
  const parent = readParent(call, drafts, binding, source);
  const references: ColumnReference[] = [];
  if (parent.target !== null) {
    references.push({
      column: "parentId",
      target: {
        binding: parent.target.binding,
        property: parent.target.property,
        onDelete: "cascade",
        onUpdate: null,
        source,
      },
    });
  }
  // The generated fileId column references facilis_files regardless of how the parent reads.
  references.push({
    column: "fileId",
    target: {
      binding: FACILIS_FILES_BINDING,
      property: "id",
      onDelete: "cascade",
      onUpdate: null,
      source,
    },
  });
  const unknowns: UnknownFact[] = [...options.unknowns, ...parent.unknowns];
  const fact: TableFact = {
    name: options.table ?? binding ?? "unknown",
    binding,
    columns: linkColumns(options.parentColumn, source),
    primaryKey: ["id"],
    foreignKeys: [],
    policies: linkPolicies(source),
    rlsEnabled: true,
    scope: { column: "tenantId", kind: "tenant" },
    source,
    unknown: unknowns,
  };
  return { draft: { fact, binding, references }, external: facilisFilesDraft(source), unknowns };
}

/** Read the top-level `fileLinks(...)` declarators of one schema file into table drafts. */
export function collectFileLinkDrafts(
  graph: ModuleGraph,
  file: ProjectFile,
  drafts: readonly TableDraft[],
): FileLinkScan {
  const resolver = createDslResolver(graph, file);
  const context: StaticContext = { graph, file: file.path };
  const links: TableDraft[] = [];
  const externalTables: TableDraft[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const declarator of topLevelDeclarators(file.program)) {
    const binding = identifierName(declarator.id) ?? null;
    const init = unwrapExpression(declarator.init);
    if (init?.type !== "CallExpression") continue;
    const symbol = resolver(init.callee);
    if (symbol?.pkg !== DB_PACKAGE || symbol.name !== FILE_LINKS) continue;
    const result = buildLinkDraft({
      call: init,
      binding,
      drafts,
      context,
      source: nodeRef(file, init),
    });
    links.push(result.draft);
    externalTables.push(result.external);
    diagnostics.push(...schemaDiagnostics(result.unknowns));
  }
  return { drafts: links, externalTables, diagnostics };
}
