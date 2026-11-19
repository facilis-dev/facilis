import {
  asNode,
  identifierName,
  memberName,
  nodeArray,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { staticString, type StaticContext } from "../static-eval.ts";
import type { DslResolver } from "./schema-dsl.ts";

export interface SqlRenderInput {
  readonly context: StaticContext;
  readonly resolver: DslResolver;
  /** Name of the first pgTable extras callback parameter (table in (table) => ...). */
  readonly tableParam: string | null;
  readonly tableName: string;
  /** Drizzle property key -> SQL column name, so interpolated column refs render as SQL. */
  readonly columns: ReadonlyMap<string, string>;
  /**
   * Policy predicates must be replayable verbatim, so a template with any interpolation is
   * unreadable (null + reason). Index/check expressions allow column and identifier
   * references, whose SQL PgDialect would inline; a value interpolation would become a bind
   * parameter, which is not replayable, so it stays unreadable there too.
   */
  readonly allowExpressions: boolean;
}

/** SQL text of a drizzle sql template, or null with the reason it cannot be read. */
export interface SqlRender {
  readonly sql: string | null;
  readonly reason: string | null;
}

function unreadable(reason: string): SqlRender {
  return { sql: null, reason };
}

function quote(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}

/** TemplateElement.value is a plain { raw, cooked } record, not an AST node. */
function templateText(node: AstNode): string | null {
  const value = node["value"];
  if (typeof value !== "object" || value === null) return null;
  const record = value as { cooked?: unknown; raw?: unknown };
  if (typeof record.cooked === "string") return record.cooked;
  return typeof record.raw === "string" ? record.raw : null;
}

function renderInterpolation(node: AstNode, input: SqlRenderInput): SqlRender {
  const expression = unwrapExpression(node);
  if (expression === undefined) return unreadable("sql interpolation is not an expression");
  if (expression.type === "MemberExpression") {
    const object = identifierName(unwrapExpression(expression.object));
    const property = memberName(expression);
    if (object === input.tableParam && property !== undefined) {
      const column = input.columns.get(property);
      return column === undefined
        ? unreadable('sql interpolation column "' + property + '" is not a table column')
        : { sql: quote(input.tableName) + "." + quote(column), reason: null };
    }
    return unreadable("sql interpolation is not a column reference");
  }
  if (expression.type === "Identifier" && identifierName(expression) === input.tableParam) {
    return { sql: quote(input.tableName), reason: null };
  }
  if (expression.type === "CallExpression") {
    const callee = unwrapExpression(expression.callee);
    const symbol = callee === undefined ? null : input.resolver(callee);
    if (symbol?.pkg === "drizzle-orm" && symbol.name === "identifier") {
      const args = nodeArray(expression, "arguments");
      const name = staticString(args[0], input.context);
      return name.ok
        ? { sql: quote(name.value), reason: null }
        : unreadable("sql.identifier argument is not a static string");
    }
  }
  return unreadable("sql interpolation would render as a bind parameter");
}

export function renderSqlTemplate(node: AstNode | undefined, input: SqlRenderInput): SqlRender {
  const value = unwrapExpression(node);
  if (value?.type !== "TaggedTemplateExpression") {
    return unreadable("not a drizzle sql template literal");
  }
  const tag = unwrapExpression(value.tag);
  const symbol = tag === undefined ? null : input.resolver(tag);
  if (symbol?.pkg !== "drizzle-orm" || symbol.name !== "sql") {
    return unreadable("not the drizzle sql template tag");
  }
  const quasi = asNode(value.quasi);
  if (quasi === undefined) return unreadable("sql template has no quasis");
  const quasis = nodeArray(quasi, "quasis");
  const expressions = nodeArray(quasi, "expressions");
  // A policy predicate must be replayable as-is: interpolation cannot be inlined faithfully.
  if (!input.allowExpressions && expressions.length > 0) {
    return unreadable("sql template has interpolated expressions");
  }
  let sql = "";
  for (const [index, chunk] of quasis.entries()) {
    const text = templateText(chunk);
    if (text === null) return unreadable("sql template chunk is not static");
    sql += text;
    const interpolation = expressions[index];
    if (interpolation === undefined) continue;
    const rendered = renderInterpolation(interpolation, input);
    if (rendered.sql === null) return rendered;
    sql += rendered.sql;
  }
  return { sql, reason: null };
}
