import {
  callArguments,
  identifierName,
  memberName,
  nodeArray,
  objectEntries,
  propertyName,
  propertyValue,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { Diagnostic, RelationFact, UnknownFact } from "../types.ts";
import {
  callbackExpression,
  createDslResolver,
  nodeRef,
  schemaDiagnostics,
  schemaUnknown,
  topLevelDeclarators,
  type DslResolver,
} from "./schema-dsl.ts";
import { resolveTableBinding, type TableLookup } from "./schema-foreign-keys.ts";

export interface RelationScan {
  readonly relations: readonly RelationFact[];
  readonly diagnostics: readonly Diagnostic[];
}

interface HelperBindings {
  readonly one: ReadonlySet<string>;
  readonly many: ReadonlySet<string>;
}

/** Map the callback's destructured `one`/`many` helpers to their local names. */
function helperBindings(callback: AstNode | undefined): HelperBindings | null {
  const fn = unwrapExpression(callback);
  if (fn === undefined) return null;
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return null;
  const param = unwrapExpression(nodeArray(fn, "params")[0]);
  if (param?.type !== "ObjectPattern") return null;
  const one = new Set<string>();
  const many = new Set<string>();
  for (const property of objectEntries(param)) {
    if (property.type === "SpreadElement") continue;
    const key = propertyName(property);
    const local = identifierName(propertyValue(property));
    if (local === undefined) continue;
    if (key === "one") one.add(local);
    if (key === "many") many.add(local);
  }
  return { one, many };
}

function readColumnList(
  options: AstNode | undefined,
  file: ProjectFile,
  unknowns: UnknownFact[],
): { fields: string[]; references: string[] } {
  const empty = { fields: [] as string[], references: [] as string[] };
  if (options === undefined) return empty;
  const node = unwrapExpression(options);
  if (node?.type !== "ObjectExpression") {
    unknowns.push(
      schemaUnknown("relation options are not an object literal", nodeRef(file, options)),
    );
    return empty;
  }
  const readList = (key: string): string[] => {
    const property = objectEntries(node).find((entry) => propertyName(entry) === key);
    if (property === undefined) return [];
    const value = unwrapExpression(propertyValue(property));
    if (value?.type !== "ArrayExpression") {
      unknowns.push(
        schemaUnknown("relation " + key + " is not an array literal", nodeRef(file, property)),
      );
      return [];
    }
    const columns: string[] = [];
    for (const element of nodeArray(value, "elements")) {
      const item = unwrapExpression(element);
      const name = item?.type === "MemberExpression" ? memberName(item) : identifierName(item);
      if (name === undefined) {
        unknowns.push(
          schemaUnknown(
            "relation " + key + " entry is not a column reference",
            nodeRef(file, item),
          ),
        );
        continue;
      }
      columns.push(name);
    }
    return columns;
  };
  return { fields: readList("fields"), references: readList("references") };
}

function readRelationEntry(input: {
  readonly entry: AstNode;
  readonly from: string;
  readonly graph: ModuleGraph;
  readonly file: ProjectFile;
  readonly lookup: TableLookup;
  readonly helpers: HelperBindings;
}): { relation: RelationFact | null; diagnostics: readonly Diagnostic[] } {
  const { entry, from, graph, file, lookup, helpers } = input;
  const unknowns: UnknownFact[] = [];
  const value = unwrapExpression(propertyValue(entry));
  const source = nodeRef(file, entry);
  if (value?.type !== "CallExpression") {
    return {
      relation: null,
      diagnostics: schemaDiagnostics([
        schemaUnknown("relations() entry is not a one()/many() call", source),
      ]),
    };
  }
  const calleeLocal = identifierName(unwrapExpression(value.callee));
  const cardinality =
    calleeLocal !== undefined && helpers.one.has(calleeLocal)
      ? "one"
      : calleeLocal !== undefined && helpers.many.has(calleeLocal)
        ? "many"
        : null;
  if (cardinality === null) {
    return {
      relation: null,
      diagnostics: schemaDiagnostics([
        schemaUnknown("relations() entry is not a one()/many() call", source),
      ]),
    };
  }
  const args = callArguments(value);
  const targetLocal = identifierName(unwrapExpression(args[0]));
  const targetTable =
    targetLocal === undefined ? null : resolveTableBinding(graph, file.path, targetLocal, lookup);
  if (targetTable === null) {
    unknowns.push(schemaUnknown("relation target table is not resolvable statically", source));
  }
  const columns = readColumnList(args[1], file, unknowns);
  const relation: RelationFact = {
    from,
    to: targetTable ?? targetLocal ?? "unknown",
    cardinality,
    fields: columns.fields,
    references: columns.references,
    source,
    unknown: unknowns,
  };
  return { relation, diagnostics: schemaDiagnostics(unknowns) };
}

function readRelations(input: {
  readonly graph: ModuleGraph;
  readonly file: ProjectFile;
  readonly call: AstNode;
  readonly lookup: TableLookup;
}): RelationScan {
  const { graph, file, call, lookup } = input;
  const source = nodeRef(file, call);
  const args = callArguments(call);
  const fromLocal = identifierName(unwrapExpression(args[0]));
  const fromTable =
    fromLocal === undefined ? null : resolveTableBinding(graph, file.path, fromLocal, lookup);
  const from = fromTable ?? fromLocal ?? "unknown";
  const callback = args[1];
  const body = callbackExpression(callback);
  const helpers = helperBindings(callback);
  if (body?.type !== "ObjectExpression" || helpers === null) {
    return {
      relations: [],
      diagnostics: schemaDiagnostics([
        schemaUnknown("relations() callback is not a destructured one/many callback", source),
      ]),
    };
  }
  const relations: RelationFact[] = [];
  const diagnostics: Diagnostic[] = [];
  if (fromTable === null) {
    const unknown = schemaUnknown("relation source table is not resolvable statically", source);
    diagnostics.push(...schemaDiagnostics([unknown]));
  }
  for (const entry of objectEntries(body)) {
    if (propertyName(entry) === undefined) {
      diagnostics.push(
        ...schemaDiagnostics([
          schemaUnknown("computed relation key is outside the DSL", nodeRef(file, entry)),
        ]),
      );
      continue;
    }
    const result = readRelationEntry({ entry, from, graph, file, lookup, helpers });
    if (result.relation !== null) relations.push(result.relation);
    diagnostics.push(...result.diagnostics);
  }
  return { relations, diagnostics };
}

export function buildRelationFacts(
  graph: ModuleGraph,
  files: readonly ProjectFile[],
  lookup: TableLookup,
): RelationScan {
  const relations: RelationFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const resolver: DslResolver = createDslResolver(graph, file);
    for (const declarator of topLevelDeclarators(file.program)) {
      const call = unwrapExpression(declarator.init);
      if (call?.type !== "CallExpression") continue;
      const symbol = resolver(call.callee);
      if (symbol?.pkg !== "drizzle-orm" || symbol.name !== "relations") continue;
      const scan = readRelations({ graph, file, call, lookup });
      relations.push(...scan.relations);
      diagnostics.push(...scan.diagnostics);
    }
  }
  return { relations: dedupeRelations(relations), diagnostics };
}

/** Duplicate declarations (e.g. split files) must not duplicate edges. */
function dedupeRelations(relations: readonly RelationFact[]): RelationFact[] {
  const seen = new Set<string>();
  const out: RelationFact[] = [];
  for (const relation of relations) {
    const key = [
      relation.from,
      relation.to,
      relation.cardinality,
      relation.fields.join(","),
      relation.references.join(","),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(relation);
  }
  return out;
}
