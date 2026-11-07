import type { AstNode } from "../ast/node.ts";
import { isRecord } from "../json.ts";
import { evaluateStatic, type StaticContext } from "../static-eval.ts";
import type { ColumnDefaultFact } from "../types.ts";

/** Static object argument of a builder/method, e.g. `{ withTimezone: true }`. */
export function optionsOf(
  node: AstNode | undefined,
  context: StaticContext,
): Record<string, unknown> | null {
  if (node === undefined) return null;
  const evaluated = evaluateStatic(node, context);
  return evaluated.ok && isRecord(evaluated.value) ? evaluated.value : null;
}

/** Display type derived from the builder and its static arguments (never a rendered SQL type). */
export function displayType(
  name: string,
  args: readonly AstNode[],
  context: StaticContext,
): string {
  switch (name) {
    case "varchar": {
      const length = optionsOf(args[1], context)?.["length"];
      return typeof length === "number" ? "varchar(" + length + ")" : "varchar";
    }
    case "timestamp": {
      const options = optionsOf(args[1], context);
      const precision = options?.["precision"];
      const base = typeof precision === "number" ? "timestamp(" + precision + ")" : "timestamp";
      return options?.["withTimezone"] === true ? base + " with time zone" : base;
    }
    case "numeric": {
      const options = optionsOf(args[1], context);
      const precision = options?.["precision"];
      if (typeof precision !== "number") return "numeric";
      const scale = options?.["scale"];
      return typeof scale === "number"
        ? "numeric(" + precision + ", " + scale + ")"
        : "numeric(" + precision + ")";
    }
    case "doublePrecision":
      return "double precision";
    case "tenantColumn":
      return "uuid";
    default:
      return name;
  }
}

/** `.default(value)`: only primitives are facts; a SQL expression is an explicit unknown. */
export function readDefault(node: AstNode | undefined, context: StaticContext): ColumnDefaultFact {
  if (node === undefined) return { kind: "unknown", value: null };
  const evaluated = evaluateStatic(node, context);
  if (!evaluated.ok) return { kind: "unknown", value: null };
  const value = evaluated.value;
  if (value === null) return { kind: "literal", value: "null" };
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { kind: "literal", value: String(value) };
  }
  return { kind: "unknown", value: null };
}
