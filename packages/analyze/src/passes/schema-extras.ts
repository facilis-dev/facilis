import {
  callArguments,
  identifierName,
  memberName,
  nodeArray,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { StaticContext } from "../static-eval.ts";
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
import { readCheck, readPrimaryKey, readUniqueConstraint } from "./schema-constraints.ts";
import { readIndex } from "./schema-indexes.ts";

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
  /**
   * Ordered Drizzle property keys of a table-level `primaryKey({ columns })`; null when the
   * table declares none (column-level `.primaryKey()` then applies). A present-but-unreadable
   * key is [] plus an unsupported entry, never a silent fall back to the column level.
   */
  readonly primaryKey: readonly string[] | null;
  readonly unsupported: readonly UnsupportedDeclarationFact[];
  readonly unknown: readonly UnknownFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function emptyScan(): TableExtrasScan {
  return { indexes: [], checks: [], uniqueConstraints: [], primaryKey: null, unsupported: [], unknown: [], diagnostics: [] };
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

/** Extras entries that are not index/check/unique/policy/primaryKey are unreadable, never noise. */
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
  let primaryKey: string[] | null = null;
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
    // pgPolicy is read by schema-policies.ts, so the extras scan must not double-report it.
    if (symbol.name === "pgPolicy") continue;
    if (symbol.name === "primaryKey") {
      // The runtime keeps the first table-level key; a second one is a broken declaration.
      if (primaryKey !== null) {
        unknown.push(schemaUnknown("table declares more than one primaryKey", nodeRef(input.file, chain.base)));
        continue;
      }
      const key = readPrimaryKey(chain, input, callback.param);
      primaryKey = [...key.columns];
      unknown.push(...key.unknown);
      if (key.unknown.length > 0) unsupported.push({ construct: "primary_key", name: input.tableName });
      continue;
    }
    unknown.push(
      schemaUnknown('table extras call "' + symbol.name + '" is outside the documented DSL', nodeRef(input.file, chain.base)),
    );
  }
  return {
    indexes,
    checks,
    uniqueConstraints,
    primaryKey,
    unsupported,
    unknown,
    diagnostics: schemaDiagnostics(unknown),
  };
}