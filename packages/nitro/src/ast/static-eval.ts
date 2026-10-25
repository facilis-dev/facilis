import { asNode, isAstNode, propertyName, propertyValue, type AstNode } from "./ast.ts";

/** Result of trying to turn an expression into a plain JavaScript value. */
export type StaticEvaluation = { ok: true; value: unknown } | { ok: false; reason: string };

function fail(reason: string): StaticEvaluation {
  return { ok: false, reason };
}

/**
 * Evaluate an expression statically. Only literals, arrays and object literals are
 * supported by design: the AST pass never executes user code (SPEC §13 risk 3).
 */
export function evaluateStatic(node: AstNode | undefined): StaticEvaluation {
  if (!node) return fail("missing value");
  switch (node.type) {
    case "Literal":
      return { ok: true, value: node.value };
    case "TemplateLiteral":
      return evaluateTemplate(node);
    case "ObjectExpression":
      return evaluateObject(node);
    case "ArrayExpression":
      return evaluateArray(node);
    case "UnaryExpression":
      return evaluateUnary(node);
    case "ParenthesizedExpression":
    case "TSNonNullExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSInstantiationExpression":
      return evaluateStatic(asNode(node.expression));
    default:
      return fail(`"${node.type}" is not a static literal`);
  }
}

function evaluateTemplate(node: AstNode): StaticEvaluation {
  const expressions = node.expressions;
  const quasis = node.quasis;
  if (!Array.isArray(quasis) || quasis.length !== 1) return fail("multi-part template literal");
  if (Array.isArray(expressions) && expressions.length > 0)
    return fail("template literal interpolation");
  const quasi = asNode(quasis[0]);
  const value = quasi?.value as { cooked?: unknown } | undefined;
  return typeof value?.cooked === "string"
    ? { ok: true, value: value.cooked }
    : fail("template literal");
}

function evaluateObject(node: AstNode): StaticEvaluation {
  const properties = node.properties;
  if (!Array.isArray(properties)) return fail("object expression without properties");
  const out: Record<string, unknown> = {};
  for (const entry of properties) {
    if (!isAstNode(entry)) return fail("unsupported object entry");
    if (entry.type !== "Property") return fail("object spread is not statically resolvable");
    const key = propertyName(entry);
    if (key === undefined) return fail("computed object key is not statically resolvable");
    const value = evaluateStatic(propertyValue(entry));
    if (!value.ok) return value;
    out[key] = value.value;
  }
  return { ok: true, value: out };
}

function evaluateArray(node: AstNode): StaticEvaluation {
  const elements = node.elements;
  if (!Array.isArray(elements)) return fail("array expression without elements");
  const out: unknown[] = [];
  for (const element of elements) {
    const candidate = asNode(element);
    if (!candidate) return fail("array holes are not statically resolvable");
    const value = evaluateStatic(candidate);
    if (!value.ok) return value;
    out.push(value.value);
  }
  return { ok: true, value: out };
}

function evaluateUnary(node: AstNode): StaticEvaluation {
  const operator = node.operator;
  const argument = asNode(node.argument);
  if (operator !== "-" || argument?.type !== "Literal" || typeof argument.value !== "number") {
    return fail("unsupported unary expression");
  }
  return { ok: true, value: -argument.value };
}
