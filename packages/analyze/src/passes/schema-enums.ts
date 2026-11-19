import { callArguments, identifierName, unwrapExpression } from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { staticString, staticStringArray, type StaticContext } from "../static-eval.ts";
import type { Diagnostic, EnumFact, UnknownFact } from "../types.ts";
import {
  createDslResolver,
  nodeRef,
  schemaDiagnostics,
  schemaUnknown,
  topLevelDeclarators,
} from "./schema-dsl.ts";

export interface EnumDeclarations {
  readonly facts: readonly EnumFact[];
  /** Local binding -> enum name, for the column pass that sees `eventKind(...)` builders. */
  readonly bindings: ReadonlyMap<string, string>;
  readonly diagnostics: readonly Diagnostic[];
}

/** Read the module-level `pgEnum("name", [...])` consts of one schema file. */
export function collectEnumDeclarations(graph: ModuleGraph, file: ProjectFile): EnumDeclarations {
  const resolver = createDslResolver(graph, file);
  const context: StaticContext = { graph, file: file.path };
  const facts: EnumFact[] = [];
  const bindings = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  for (const declarator of topLevelDeclarators(file.program)) {
    const binding = identifierName(declarator.id);
    const init = unwrapExpression(declarator.init);
    if (binding === undefined || init?.type !== "CallExpression") continue;
    const symbol = resolver(init.callee);
    if (symbol?.pkg !== "pg-core" || symbol.name !== "pgEnum") continue;
    const args = callArguments(init);
    const source = nodeRef(file, init);
    const unknowns: UnknownFact[] = [];
    const nameResult = staticString(args[0], context);
    if (!nameResult.ok) unknowns.push(schemaUnknown("pgEnum name is not a static string", source));
    const valuesResult = staticStringArray(args[1], context);
    if (!valuesResult.ok) {
      unknowns.push(schemaUnknown("pgEnum values are not a static string array", source));
    }
    const name = nameResult.ok ? nameResult.value : binding;
    facts.push({
      name,
      values: valuesResult.ok ? valuesResult.value : [],
      source,
      unknown: unknowns,
    });
    bindings.set(binding, name);
    diagnostics.push(...schemaDiagnostics(unknowns));
  }
  return { facts, bindings, diagnostics };
}

export interface EnumScan {
  readonly enums: readonly EnumFact[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Project-wide enum facts, deduped by name (the first declaration wins, like tables). */
export function collectEnumFacts(graph: ModuleGraph, files: readonly ProjectFile[]): EnumScan {
  const enums: EnumFact[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const scan = collectEnumDeclarations(graph, file);
    diagnostics.push(...scan.diagnostics);
    for (const fact of scan.facts) {
      if (seen.has(fact.name)) continue;
      seen.add(fact.name);
      enums.push(fact);
    }
  }
  return { enums, diagnostics };
}
