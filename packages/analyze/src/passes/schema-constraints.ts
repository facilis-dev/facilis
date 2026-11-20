// Non-index table extras: check constraints, table-level unique constraints and the
// table-level primaryKey. Split from schema-extras.ts (the dispatch) to keep both under the
// 300-line limit; the index reader lives in schema-indexes.ts.

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
import { staticString, type StaticContext } from "../static-eval.ts";
import type { CheckFact, UniqueConstraintFact, UnknownFact } from "../types.ts";
import { nodeRef, schemaUnknown } from "./schema-dsl.ts";
import type { ExtrasCall, TableExtrasInput } from "./schema-extras.ts";
import { plainColumn } from "./schema-indexes.ts";
import { renderSqlTemplate } from "./schema-sql.ts";

export function readCheck(
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

export function readUniqueConstraint(
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

/** The Drizzle property key of a plain `table.column` reference, or null (fail closed). */
function plainColumnProperty(
  node: AstNode | undefined,
  tableParam: string | null,
  columns: ReadonlyMap<string, string>,
): string | null {
  if (node?.type !== "MemberExpression") return null;
  if (identifierName(unwrapExpression(node.object)) !== tableParam) return null;
  const property = memberName(node);
  if (property === undefined) return null;
  return columns.has(property) ? property : null;
}

/**
 * A table-level `primaryKey({ columns: [table.a, table.b] })`. Returns the ordered property
 * keys; an unreadable column list yields [] plus unknown facts so the caller fails closed
 * instead of silently dropping the key (the runtime always reads it, so a silent [] would
 * diverge from the declared snapshot).
 */
export function readPrimaryKey(
  call: ExtrasCall,
  input: TableExtrasInput,
  tableParam: string | null,
): { readonly columns: string[]; readonly unknown: UnknownFact[] } {
  const source = nodeRef(input.file, call.base);
  const unknowns: UnknownFact[] = [];
  if (call.methods.length > 0) {
    unknowns.push(schemaUnknown("primaryKey does not take chain methods", source));
    return { columns: [], unknown: unknowns };
  }
  const options = unwrapExpression(callArguments(call.base)[0]);
  let columnArray: AstNode | undefined;
  if (options?.type === "ObjectExpression") {
    for (const entry of objectEntries(options)) {
      if (propertyName(entry) === "columns") {
        columnArray = unwrapExpression(propertyValue(entry));
        break;
      }
    }
  }
  if (columnArray?.type !== "ArrayExpression") {
    unknowns.push(schemaUnknown("primaryKey columns are not a readable array", source));
    return { columns: [], unknown: unknowns };
  }
  const columns: string[] = [];
  for (const element of nodeArray(columnArray, "elements")) {
    const property = plainColumnProperty(unwrapExpression(element), tableParam, input.columns);
    if (property === null) {
      unknowns.push(schemaUnknown("primaryKey column is not a plain table column", source));
      return { columns: [], unknown: unknowns };
    }
    columns.push(property);
  }
  if (columns.length === 0) unknowns.push(schemaUnknown("primaryKey declares no columns", source));
  return { columns, unknown: unknowns };
}
