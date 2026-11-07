import {
  callArguments,
  identifierName,
  memberName,
  objectEntries,
  propertyName,
  propertyValue,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { diagnostic } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { staticString } from "../static-eval.ts";
import type { ConfigFacts, Diagnostic, TableFact, UnknownFact } from "../types.ts";
import { buildColumnFact, type ColumnReference } from "./schema-columns.ts";
import { scopeOf, type ScopedColumn } from "./schema-scope.ts";
import {
  createDslResolver,
  nodeRef,
  schemaDiagnostics,
  schemaUnknown,
  topLevelDeclarators,
  type DslResolver,
} from "./schema-dsl.ts";
import { buildPolicyFacts } from "./schema-policies.ts";

export interface TableDraft {
  readonly fact: TableFact;
  readonly binding: string | null;
  readonly references: readonly ColumnReference[];
}

export interface TableScan {
  readonly drafts: readonly TableDraft[];
  readonly diagnostics: readonly Diagnostic[];
}

interface TableCall {
  readonly call: AstNode;
  readonly methods: readonly string[];
}

/** Local `pgEnum("name", values)` consts; a column built from one is a known enum builder. */
function collectEnumBindings(
  file: ProjectFile,
  resolver: DslResolver,
  graph: ModuleGraph,
): Map<string, string> {
  const enums = new Map<string, string>();
  for (const declarator of topLevelDeclarators(file.program)) {
    const binding = identifierName(declarator.id);
    const init = unwrapExpression(declarator.init);
    if (binding === undefined || init?.type !== "CallExpression") continue;
    const symbol = resolver(init.callee);
    if (symbol?.pkg !== "pg-core" || symbol.name !== "pgEnum") continue;
    const name = staticString(callArguments(init)[0], { graph, file: file.path });
    enums.set(binding, name.ok ? name.value : binding);
  }
  return enums;
}

/** The `pgTable` call inside `pgTable(...).enableRLS()`, plus the chain methods after it. */
function findTableCall(init: unknown, resolver: DslResolver): TableCall | null {
  let current = unwrapExpression(init);
  const methods: string[] = [];
  let guard = 0;
  while (current?.type === "CallExpression" && guard < 32) {
    guard += 1;
    const callee = unwrapExpression(current.callee);
    if (callee === undefined) return null;
    if (callee.type === "MemberExpression") {
      const name = memberName(callee);
      if (name === undefined) return null;
      methods.unshift(name);
      current = unwrapExpression(callee.object);
      continue;
    }
    const symbol = resolver(callee);
    if (symbol?.pkg !== "pg-core" || symbol.name !== "pgTable") return null;
    return { call: current, methods };
  }
  return null;
}

function buildTableDraft(input: {
  readonly graph: ModuleGraph;
  readonly file: ProjectFile;
  readonly resolver: DslResolver;
  readonly enums: ReadonlyMap<string, string>;
  readonly config: ConfigFacts;
  readonly binding: string | null;
  readonly tableCall: TableCall;
}): { draft: TableDraft; diagnostics: readonly Diagnostic[] } {
  const { graph, file, resolver, enums, config, binding, tableCall } = input;
  const source = nodeRef(file, tableCall.call);
  const args = callArguments(tableCall.call);
  const unknowns: UnknownFact[] = [];
  const diagnostics: Diagnostic[] = [];
  const nameResult = staticString(args[0], { graph, file: file.path });
  let name: string;
  if (nameResult.ok && nameResult.value.length > 0) {
    name = nameResult.value;
  } else {
    name = binding ?? "unknown";
    unknowns.push(schemaUnknown('table name of "' + name + '" is not a static string', source));
  }

  const columns: ScopedColumn[] = [];
  const references: ColumnReference[] = [];
  const columnsArgument = unwrapExpression(args[1]);
  if (columnsArgument?.type !== "ObjectExpression") {
    unknowns.push(
      schemaUnknown('columns of table "' + name + '" are not an object literal', source),
    );
  } else {
    for (const entry of objectEntries(columnsArgument)) {
      if (entry.type === "SpreadElement") {
        unknowns.push(
          schemaUnknown(
            'spread columns in table "' + name + '" are outside the DSL',
            nodeRef(file, entry),
          ),
        );
        continue;
      }
      const property = propertyName(entry);
      if (property === undefined) {
        unknowns.push(
          schemaUnknown(
            'computed column key in table "' + name + '" is outside the DSL',
            nodeRef(file, entry),
          ),
        );
        continue;
      }
      const result = buildColumnFact({
        property,
        expression: propertyValue(entry),
        propertyNode: entry,
        file,
        graph,
        resolver,
        enums,
      });
      diagnostics.push(...result.diagnostics);
      if (result.reference !== null) {
        references.push({ column: property, target: result.reference });
      }
      columns.push({ column: result.column, tenant: result.tenant });
    }
  }

  const policyScan = buildPolicyFacts({
    extras: args[2],
    file,
    graph,
    resolver,
  });
  diagnostics.push(...policyScan.diagnostics);
  const rlsEnabled = tableCall.methods.includes("enableRLS");
  const scope = scopeOf(columns, config);
  const fact: TableFact = {
    name,
    binding,
    columns: columns.map((entry) => entry.column),
    primaryKey: columns
      .filter((entry) => entry.column.primaryKey)
      .map((entry) => entry.column.property),
    foreignKeys: [],
    policies: policyScan.policies,
    rlsEnabled,
    scope,
    source,
    unknown: unknowns,
  };
  diagnostics.push(...schemaDiagnostics(unknowns));
  if (scope !== null && (!rlsEnabled || policyScan.policies.length === 0)) {
    diagnostics.push(
      diagnostic(
        "rls-on-scoped-table",
        "error",
        'scoped table "' + name + '" must call .enableRLS() and declare a policy',
        source,
      ),
    );
  }
  return { draft: { fact, binding, references }, diagnostics };
}

export function collectTableDrafts(
  graph: ModuleGraph,
  file: ProjectFile,
  config: ConfigFacts,
): TableScan {
  const resolver = createDslResolver(graph, file);
  const enums = collectEnumBindings(file, resolver, graph);
  const drafts: TableDraft[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const declarator of topLevelDeclarators(file.program)) {
    const binding = identifierName(declarator.id) ?? null;
    const tableCall = findTableCall(declarator.init, resolver);
    if (tableCall === null) continue;
    const result = buildTableDraft({
      graph,
      file,
      resolver,
      enums,
      config,
      binding,
      tableCall,
    });
    drafts.push(result.draft);
    diagnostics.push(...result.diagnostics);
  }
  return { drafts, diagnostics };
}
