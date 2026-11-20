import {
  callArguments,
  identifierName,
  memberName,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { staticString, type StaticContext } from "../static-eval.ts";
import type { IndexFact, UnknownFact } from "../types.ts";
import { nodeRef, schemaUnknown } from "./schema-dsl.ts";
import type { ExtrasCall, TableExtrasInput } from "./schema-extras.ts";
import { renderSqlTemplate } from "./schema-sql.ts";
type IndexElement =
  | { readonly kind: "column"; readonly column: string }
  | { readonly kind: "expression"; readonly sql: string }
  | { readonly kind: "unsupported"; readonly reason: string };

export function plainColumn(
  node: AstNode,
  tableParam: string | null,
  columns: ReadonlyMap<string, string>,
): string | null {
  if (node.type !== "MemberExpression") return null;
  const object = identifierName(unwrapExpression(node.object));
  const property = memberName(node);
  if (object !== tableParam || property === undefined) return null;
  return columns.get(property) ?? null;
}

function orderedColumn(
  node: AstNode,
  tableParam: string | null,
  columns: ReadonlyMap<string, string>,
): IndexElement | null {
  if (node.type !== "CallExpression") return null;
  const callee = unwrapExpression(node.callee);
  if (callee?.type !== "MemberExpression") return null;
  const method = memberName(callee);
  if (method === "asc") {
    const object = unwrapExpression(callee.object);
    const column = object === undefined ? null : plainColumn(object, tableParam, columns);
    return column === null
      ? { kind: "unsupported", reason: "index element is not a plain column" }
      : { kind: "column", column };
  }
  if (method === "desc" || method === "nullsFirst" || method === "nullsLast" || method === "op") {
    return { kind: "unsupported", reason: 'index column modifier ".' + method + '" is not a plain column' };
  }
  return null;
}

function classifyIndexElement(
  element: AstNode,
  input: TableExtrasInput,
  context: StaticContext,
  tableParam: string | null,
): IndexElement {
  const node = unwrapExpression(element);
  if (node === undefined) return { kind: "unsupported", reason: "index element is not an expression" };
  if (node.type === "TaggedTemplateExpression") {
    const rendered = renderSqlTemplate(node, {
      context,
      resolver: input.resolver,
      tableParam,
      tableName: input.tableName,
      columns: input.columns,
      allowExpressions: true,
    });
    return rendered.sql === null
      ? { kind: "unsupported", reason: rendered.reason ?? "index expression is not static" }
      : { kind: "expression", sql: rendered.sql };
  }
  const column = plainColumn(node, tableParam, input.columns);
  if (column !== null) return { kind: "column", column };
  return (
    orderedColumn(node, tableParam, input.columns) ?? {
      kind: "unsupported",
      reason: "index element is not a plain column or SQL expression",
    }
  );
}

export function readIndex(
  call: ExtrasCall,
  unique: boolean,
  input: TableExtrasInput,
  context: StaticContext,
  tableParam: string | null,
): IndexFact {
  const source = nodeRef(input.file, call.base);
  const unknowns: UnknownFact[] = [];
  const nameResult = staticString(callArguments(call.base)[0], context);
  const name = nameResult.ok ? nameResult.value : "unknown";
  if (!nameResult.ok) unknowns.push(schemaUnknown("index name is not a static string", source));
  const reasons: string[] = [];
  let elements: readonly AstNode[] = [];
  let method: string | null = null;
  let clauseSeen = false;
  for (const entry of call.methods) {
    if (entry.name === "on" || entry.name === "using") {
      if (clauseSeen) {
        reasons.push("index has more than one column clause");
        continue;
      }
      clauseSeen = true;
      if (entry.name === "using") {
        const evaluated = staticString(entry.args[0], context);
        method = evaluated.ok ? evaluated.value : null;
        if (!evaluated.ok) unknowns.push(schemaUnknown("index method is not a static string", source));
        elements = entry.args.slice(1);
      } else {
        elements = entry.args;
      }
      continue;
    }
    if (entry.name === "where") reasons.push("partial index (where)");
    else if (entry.name === "concurrently") reasons.push("concurrently built index");
    else if (entry.name === "only") reasons.push("only index");
    else if (entry.name === "with") reasons.push("index storage parameters (with)");
    else reasons.push('index method ".' + entry.name + '" is not supported');
  }
  if (method !== null && method !== "btree") reasons.push('non-btree index method "' + method + '"');
  if (!clauseSeen) reasons.push("index has no on/using column clause");
  if (reasons.length > 0) {
    return { name, columns: [], expression: null, unique, unsupported: reasons.join("; "), source, unknown: unknowns };
  }
  const classified = elements.map((element) => classifyIndexElement(element, input, context, tableParam));
  const columnCount = classified.filter((entry) => entry.kind === "column").length;
  const expressionCount = classified.filter((entry) => entry.kind === "expression").length;
  const firstProblem = classified.find((entry) => entry.kind === "unsupported");
  if (firstProblem !== undefined && firstProblem.kind === "unsupported") {
    return { name, columns: [], expression: null, unique, unsupported: firstProblem.reason, source, unknown: unknowns };
  }
  if (expressionCount === 0 && columnCount === classified.length) {
    return {
      name,
      columns: classified.flatMap((entry) => (entry.kind === "column" ? [entry.column] : [])),
      expression: null,
      unique,
      unsupported: null,
      source,
      unknown: unknowns,
    };
  }
  if (classified.length === 1 && expressionCount === 1) {
    const only = classified[0];
    return {
      name,
      columns: [],
      expression: only?.kind === "expression" ? only.sql : null,
      unique,
      unsupported: null,
      source,
      unknown: unknowns,
    };
  }
  const reason =
    expressionCount > 1
      ? "multi-expression index"
      : "mixed column/expression index";
  return { name, columns: [], expression: null, unique, unsupported: reason, source, unknown: unknowns };
}
