import {
  callArguments,
  identifierName,
  memberName,
  nodeArray,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { staticString, type StaticContext } from "../static-eval.ts";
import type {
  CheckFact,
  Diagnostic,
  IndexFact,
  UniqueConstraintFact,
  UnknownFact,
  UnsupportedDeclarationFact,
} from "../types.ts";
import {
  callbackExpression,
  nodeRef,
  schemaDiagnostics,
  schemaUnknown,
  type DslResolver,
  type DslSymbol,
} from "./schema-dsl.ts";
import { plainColumn, readIndex } from "./schema-indexes.ts";
import { renderSqlTemplate } from "./schema-sql.ts";

/** Policy helpers are read by schema-policies.ts; the extras scan must not double-report them. */
const POLICY_HELPERS = new Set([
  "tenantIsolationPolicy",
  "ownerIsolationPolicy",
  "rolePolicy",
  "rlsForTable",
  "withRls",
]);

export interface TableExtrasInput {
  readonly extras: AstNode | undefined;
  readonly file: ProjectFile;
  readonly graph: ModuleGraph;
  readonly resolver: DslResolver;
  readonly tableName: string;
  /** Drizzle property key -> SQL column name, for expression rendering. */
  readonly columns: ReadonlyMap<string, string>;
}

export interface TableExtrasScan {
  readonly indexes: readonly IndexFact[];
  readonly checks: readonly CheckFact[];
  readonly uniqueConstraints: readonly UniqueConstraintFact[];
  readonly unsupported: readonly UnsupportedDeclarationFact[];
  readonly unknown: readonly UnknownFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function emptyScan(): TableExtrasScan {
  return { indexes: [], checks: [], uniqueConstraints: [], unsupported: [], unknown: [], diagnostics: [] };
}

interface MethodCall {
  readonly name: string;
  readonly args: readonly AstNode[];
  readonly node: AstNode;
}

export interface ExtrasCall {
  readonly base: AstNode;
  readonly symbol: DslSymbol | null;
  readonly methods: readonly MethodCall[];
}

interface ExtrasCallback {
  readonly body: AstNode;
  readonly param: string | null;
}

function extrasCallback(extras: AstNode | undefined): ExtrasCallback | null {
  const fn = unwrapExpression(extras);
  if (fn === undefined) return null;
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return null;
  const body = callbackExpression(fn);
  if (body === undefined) return null;
  return { body, param: identifierName(nodeArray(fn, "params")[0]) ?? null };
}

/** Walk an index(...).on(...).where(...) style chain back to its base DSL call. */
function readCallChain(element: AstNode, resolver: DslResolver): ExtrasCall | null {
  let current: AstNode | undefined = unwrapExpression(element);
  const methods: MethodCall[] = [];
  let guard = 0;
  while (current?.type === "CallExpression" && guard < 32) {
    guard += 1;
    const callee = unwrapExpression(current.callee);
    if (callee === undefined) return null;
    if (callee.type === "MemberExpression") {
      const name = memberName(callee);
      if (name === undefined) return null;
      methods.unshift({ name, args: callArguments(current), node: current });
      current = unwrapExpression(callee.object);
      continue;
    }
    return { base: current, symbol: resolver(current.callee), methods };
  }
  return null;
}

function isPolicyEntry(node: AstNode | undefined, resolver: DslResolver): boolean {
  const value = unwrapExpression(node);
  if (value === undefined) return false;
  if (value.type === "CallExpression") {
    const symbol = resolver(value.callee);
    if (symbol === null) return false;
    if (symbol.pkg === "facilis-db") return POLICY_HELPERS.has(symbol.name);
    return symbol.pkg === "pg-core" && symbol.name === "pgPolicy";
  }
  if (value.type === "MemberExpression" && memberName(value) === "policies") {
    const object = unwrapExpression(value.object);
    if (object?.type !== "CallExpression") return false;
    const symbol = resolver(object.callee);
    return (
      symbol?.pkg === "facilis-db" &&
      (symbol.name === "rlsForTable" || symbol.name === "withRls")
    );
  }
  return false;
}

function calleeLabel(callee: unknown): string {
  const node = unwrapExpression(callee);
  if (node === undefined) return "extras entry";
  return identifierName(node) ?? memberName(node) ?? "extras entry";
}


function readCheck(
  call: ExtrasCall,
  input: TableExtrasInput,
  context: StaticContext,
  tableParam: string | null,
): CheckFact {
  const source = nodeRef(input.file, call.base);
  const unknowns: UnknownFact[] = [];
  const args = callArguments(call.base);
  const nameResult = staticString(args[0], context);
  const name = nameResult.ok ? nameResult.value : "unknown";
  if (!nameResult.ok) unknowns.push(schemaUnknown("check name is not a static string", source));
  if (args[1] === undefined) {
    unknowns.push(schemaUnknown('check "' + name + '" has no expression', source));
    return { name, expression: null, source, unknown: unknowns };
  }
  const rendered = renderSqlTemplate(args[1], {
    context,
    resolver: input.resolver,
    tableParam,
    tableName: input.tableName,
    columns: input.columns,
    allowExpressions: true,
  });
  if (rendered.sql === null) {
    unknowns.push(
      schemaUnknown('check "' + name + '" is not a readable sql template: ' + (rendered.reason ?? ""), source),
    );
  }
  return { name, expression: rendered.sql, source, unknown: unknowns };
}

function readUniqueConstraint(
  call: ExtrasCall,
  input: TableExtrasInput,
  context: StaticContext,
  tableParam: string | null,
): UniqueConstraintFact {
  const source = nodeRef(input.file, call.base);
  const unknowns: UnknownFact[] = [];
  const nameResult = staticString(callArguments(call.base)[0], context);
  const name = nameResult.ok ? nameResult.value : "unknown";
  if (!nameResult.ok) unknowns.push(schemaUnknown("unique constraint name is not a static string", source));
  let elements: readonly AstNode[] = [];
  let clauseSeen = false;
  for (const entry of call.methods) {
    if (entry.name === "on") {
      if (clauseSeen) {
        unknowns.push(schemaUnknown("unique constraint has more than one column clause", source));
        continue;
      }
      clauseSeen = true;
      elements = entry.args;
      continue;
    }
    unknowns.push(
      schemaUnknown('unique constraint method ".' + entry.name + '" is not modeled', source),
    );
  }
  if (!clauseSeen) unknowns.push(schemaUnknown("unique constraint has no on() column clause", source));
  const columns: string[] = [];
  for (const element of elements) {
    const node = unwrapExpression(element);
    const column = node === undefined ? null : plainColumn(node, tableParam, input.columns);
    if (column === null) {
      unknowns.push(schemaUnknown("unique constraint column is not a plain table column", source));
      return { name, columns: [], source, unknown: unknowns };
    }
    columns.push(column);
  }
  return { name, columns, source, unknown: unknowns };
}

/** Extras entries that are not index/check/unique/policy are unreadable declarations, never noise. */
export function buildTableExtras(input: TableExtrasInput): TableExtrasScan {
  if (input.extras === undefined) return emptyScan();
  const callback = extrasCallback(input.extras);
  if (callback === null) {
    const unknown = schemaUnknown("table extras are not a readable callback", nodeRef(input.file, input.extras));
    return { ...emptyScan(), unknown: [unknown], diagnostics: schemaDiagnostics([unknown]) };
  }
  const context: StaticContext = { graph: input.graph, file: input.file.path };
  const body = callback.body;
  const entries = body.type === "ArrayExpression" ? nodeArray(body, "elements") : [body];
  const indexes: IndexFact[] = [];
  const checks: CheckFact[] = [];
  const uniqueConstraints: UniqueConstraintFact[] = [];
  const unsupported: UnsupportedDeclarationFact[] = [];
  const unknown: UnknownFact[] = [];
  for (const entry of entries) {
    const spread = entry.type === "SpreadElement" ? unwrapExpression(entry.argument) : undefined;
    if (isPolicyEntry(spread ?? entry, input.resolver)) continue;
    if (entry.type === "SpreadElement") {
      unknown.push(schemaUnknown("spread table extras entry is outside the documented DSL", nodeRef(input.file, entry)));
      continue;
    }
    const node = unwrapExpression(entry);
    const chain = node === undefined ? null : readCallChain(node, input.resolver);
    if (chain === null) {
      unknown.push(schemaUnknown("table extras entry is not a call expression", nodeRef(input.file, entry)));
      continue;
    }
    const symbol = chain.symbol;
    if (symbol === null || (symbol.pkg === "facilis-db" && !POLICY_HELPERS.has(symbol.name))) {
      unknown.push(
        schemaUnknown('table extras call "' + calleeLabel(chain.base.callee) + '" is outside the documented DSL', nodeRef(input.file, chain.base)),
      );
      continue;
    }
    if (symbol.pkg === "facilis-db") continue;
    if (symbol.pkg !== "pg-core") {
      unknown.push(
        schemaUnknown('table extras call "' + calleeLabel(chain.base.callee) + '" is outside the documented DSL', nodeRef(input.file, chain.base)),
      );
      continue;
    }
    if (symbol.name === "index" || symbol.name === "uniqueIndex") {
      const fact = readIndex(chain, symbol.name === "uniqueIndex", input, context, callback.param);
      indexes.push(fact);
      if (fact.unsupported !== null || fact.unknown.length > 0) {
        unsupported.push({ construct: "index", name: fact.name });
      }
      continue;
    }
    if (symbol.name === "check") {
      const fact = readCheck(chain, input, context, callback.param);
      checks.push(fact);
      if (fact.unknown.length > 0) unsupported.push({ construct: "check", name: fact.name });
      continue;
    }
    if (symbol.name === "unique") {
      const fact = readUniqueConstraint(chain, input, context, callback.param);
      uniqueConstraints.push(fact);
      if (fact.unknown.length > 0) unsupported.push({ construct: "unique", name: fact.name });
      continue;
    }
    // pgPolicy is read by schema-policies.ts; table-level primaryKey() is out of this change.
    if (symbol.name === "pgPolicy" || symbol.name === "primaryKey") continue;
    unknown.push(
      schemaUnknown('table extras call "' + symbol.name + '" is outside the documented DSL', nodeRef(input.file, chain.base)),
    );
  }
  return {
    indexes,
    checks,
    uniqueConstraints,
    unsupported,
    unknown,
    diagnostics: schemaDiagnostics(unknown),
  };
}
