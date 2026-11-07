import {
  asNode,
  identifierName,
  literalString,
  memberName,
  nodeArray,
  objectEntries,
  propertyName,
  propertyValue,
  unwrapExpression,
  type AstNode,
} from "./ast/node.ts";
import { defaultExportDeclaration, localInitializer } from "./module-info.ts";
import type { ModuleGraph } from "./module-graph.ts";

export type StaticEvaluation =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };

export interface StaticContext {
  readonly graph: ModuleGraph;
  readonly file: string;
}

const MAX_DEPTH = 16;

function fail(reason: string): StaticEvaluation {
  return { ok: false, reason };
}

function fromValue(value: unknown): StaticEvaluation {
  return { ok: true, value };
}

/**
 * Evaluate the static subset (docs/findings/ast-dsl-contract.md §4): literals, arrays,
 * objects, templates without dynamic parts, same-file consts and one-hop project imports.
 * Never executes code; anything else fails and the caller records an unknown fact.
 */
export function evaluateStatic(
  node: AstNode | undefined,
  context: StaticContext,
  depth = 0,
): StaticEvaluation {
  if (node === undefined) return fail("missing value");
  if (depth > MAX_DEPTH) return fail("static evaluation is too deep or cyclic");
  const unwrapped = unwrapExpression(node) ?? node;
  switch (unwrapped.type) {
    case "Literal":
      return "value" in unwrapped ? fromValue(unwrapped.value) : fail("unsupported literal");
    case "TemplateLiteral":
      return evaluateTemplate(unwrapped, context, depth);
    case "ArrayExpression":
      return evaluateArray(unwrapped, context, depth);
    case "ObjectExpression":
      return evaluateObject(unwrapped, context, depth);
    case "UnaryExpression":
      return evaluateUnary(unwrapped, context, depth);
    case "BinaryExpression":
      return evaluateBinary(unwrapped, context, depth);
    case "MemberExpression":
      return evaluateMember(unwrapped, context, depth);
    case "Identifier":
      return evaluateIdentifier(unwrapped, context, depth);
    default:
      return fail('"' + unwrapped.type + '" is not in the static subset');
  }
}

function evaluateIdentifier(
  node: AstNode,
  context: StaticContext,
  depth: number,
): StaticEvaluation {
  const name = identifierName(node);
  if (name === undefined) return fail("missing identifier name");
  if (name === "undefined") return fromValue(undefined);
  const current = context.graph.file(context.file);
  if (current === undefined) return fail("unknown file " + context.file);
  const local = localInitializer(current.program, name);
  if (local !== undefined) return evaluateStatic(local, context, depth + 1);
  const binding = context.graph.resolveBinding(context.file, name);
  if (binding === null) return fail('cannot resolve "' + name + '" statically');
  const target = context.graph.file(binding.file);
  if (target === undefined) return fail("unknown module " + binding.file);
  if (binding.name === "default") {
    const declaration = defaultExportDeclaration(target.program);
    if (declaration === undefined) return fail("module has no default export");
    return evaluateStatic(declaration, { graph: context.graph, file: target.path }, depth + 1);
  }
  const initializer = localInitializer(target.program, binding.name);
  if (initializer === undefined) return fail('cannot resolve "' + binding.name + '" statically');
  return evaluateStatic(initializer, { graph: context.graph, file: target.path }, depth + 1);
}

function evaluateTemplate(node: AstNode, context: StaticContext, depth: number): StaticEvaluation {
  const quasis = nodeArray(node, "quasis");
  const expressions = nodeArray(node, "expressions");
  let out = "";
  for (const [index, quasi] of quasis.entries()) {
    // TemplateElement.value is a plain { raw, cooked } record, not an AST node.
    const value = quasi?.value as { cooked?: unknown } | undefined;
    const cooked = value?.cooked;
    out += typeof cooked === "string" ? cooked : "";
    const expression = expressions[index];
    if (expression === undefined) continue;
    const evaluated = evaluateStatic(expression, context, depth + 1);
    if (!evaluated.ok) return evaluated;
    if (
      typeof evaluated.value !== "string" &&
      typeof evaluated.value !== "number" &&
      typeof evaluated.value !== "boolean"
    ) {
      return fail("template interpolation is not a primitive");
    }
    out += String(evaluated.value);
  }
  return fromValue(out);
}

function evaluateArray(node: AstNode, context: StaticContext, depth: number): StaticEvaluation {
  const out: unknown[] = [];
  for (const element of nodeArray(node, "elements")) {
    const evaluated = evaluateStatic(element, context, depth + 1);
    if (!evaluated.ok) return evaluated;
    out.push(evaluated.value);
  }
  return fromValue(out);
}

function evaluateObject(node: AstNode, context: StaticContext, depth: number): StaticEvaluation {
  const out: Record<string, unknown> = {};
  for (const entry of objectEntries(node)) {
    if (entry.type === "SpreadElement") {
      const argument = asNode(entry.argument);
      const spread = evaluateStatic(argument, context, depth + 1);
      if (!spread.ok) return spread;
      if (typeof spread.value !== "object" || spread.value === null) {
        return fail("object spread is not an object literal");
      }
      Object.assign(out, spread.value);
      continue;
    }
    const key = propertyName(entry);
    if (key === undefined) return fail("computed object key is not in the static subset");
    const evaluated = evaluateStatic(propertyValue(entry), context, depth + 1);
    if (!evaluated.ok) return evaluated;
    out[key] = evaluated.value;
  }
  return fromValue(out);
}

function evaluateUnary(node: AstNode, context: StaticContext, depth: number): StaticEvaluation {
  const argument = asNode(node.argument);
  const evaluated = evaluateStatic(argument, context, depth + 1);
  if (!evaluated.ok) return evaluated;
  if (node.operator === "-" && typeof evaluated.value === "number") {
    return fromValue(-evaluated.value);
  }
  if (node.operator === "!" && typeof evaluated.value === "boolean") {
    return fromValue(!evaluated.value);
  }
  return fail("unsupported unary expression");
}

const NUMERIC_OPERATORS = new Set(["+", "-", "*", "/", "%"]);

function evaluateBinary(node: AstNode, context: StaticContext, depth: number): StaticEvaluation {
  const operator = node.operator;
  if (typeof operator !== "string" || !NUMERIC_OPERATORS.has(operator)) {
    return fail("unsupported binary expression");
  }
  const left = evaluateStatic(asNode(node.left), context, depth + 1);
  if (!left.ok) return left;
  const right = evaluateStatic(asNode(node.right), context, depth + 1);
  if (!right.ok) return right;
  if (operator === "+" && (typeof left.value === "string" || typeof right.value === "string")) {
    if (typeof left.value !== "string" && typeof left.value !== "number") {
      return fail("binary + operands are not primitives");
    }
    if (typeof right.value !== "string" && typeof right.value !== "number") {
      return fail("binary + operands are not primitives");
    }
    return fromValue(String(left.value) + String(right.value));
  }
  if (typeof left.value !== "number" || typeof right.value !== "number") {
    return fail("binary " + operator + " operands are not numbers");
  }
  switch (operator) {
    case "+":
      return fromValue(left.value + right.value);
    case "-":
      return fromValue(left.value - right.value);
    case "*":
      return fromValue(left.value * right.value);
    case "/":
      return fromValue(left.value / right.value);
    case "%":
      return fromValue(left.value % right.value);
    default:
      return fail("unsupported binary expression");
  }
}

function evaluateMember(node: AstNode, context: StaticContext, depth: number): StaticEvaluation {
  const name = memberName(node);
  if (name === undefined) return fail("unsupported member expression");
  const object = evaluateStatic(asNode(node.object), context, depth + 1);
  if (!object.ok) return object;
  if (typeof object.value !== "object" || object.value === null) {
    return fail("member access on a non-object");
  }
  const record = object.value as Record<string, unknown>;
  return Object.hasOwn(record, name) ? fromValue(record[name]) : fail("missing property " + name);
}

/** Convenience: a string or undefined, with the failure reason. */
export function staticString(
  node: AstNode | undefined,
  context: StaticContext,
): { ok: true; value: string } | { ok: false; reason: string } {
  const evaluated = evaluateStatic(node, context);
  if (!evaluated.ok) return evaluated;
  return typeof evaluated.value === "string"
    ? { ok: true, value: evaluated.value }
    : { ok: false, reason: "expected a string literal" };
}

/** Convenience: a string[] or undefined, with the failure reason. */
export function staticStringArray(
  node: AstNode | undefined,
  context: StaticContext,
): { ok: true; value: string[] } | { ok: false; reason: string } {
  const evaluated = evaluateStatic(node, context);
  if (!evaluated.ok) return evaluated;
  if (!Array.isArray(evaluated.value)) return { ok: false, reason: "expected a string[] literal" };
  if (!evaluated.value.every((item): item is string => typeof item === "string")) {
    return { ok: false, reason: "expected a string[] literal" };
  }
  return { ok: true, value: [...evaluated.value] };
}

export { literalString };
