/**
 * Minimal ESTree narrowing helpers shared by every analyzer pass.
 *
 * The AST shape is parser-independent: oxc-parser (Node, browser) and any future adapter
 * produce plain ESTree / TS-ESTree nodes. Passes never import a parser package.
 */
export interface AstNode {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

export function isAstNode(value: unknown): value is AstNode {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { type?: unknown }).type === "string";
}

export function asNode(value: unknown): AstNode | undefined {
  return isAstNode(value) ? value : undefined;
}

export function nodeArray(node: AstNode, key: string): AstNode[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isAstNode);
}

export function identifierName(node: unknown): string | undefined {
  const candidate = asNode(node);
  if (!candidate || candidate.type !== "Identifier") return undefined;
  return typeof candidate.name === "string" ? candidate.name : undefined;
}

export function literalString(node: unknown): string | undefined {
  const candidate = asNode(node);
  if (!candidate || candidate.type !== "Literal") return undefined;
  return typeof candidate.value === "string" ? candidate.value : undefined;
}

/** Name of an object-literal property, or undefined for computed/spread entries. */
export function propertyName(property: AstNode): string | undefined {
  if (property.type !== "Property") return undefined;
  const key = asNode(property.key);
  if (!key) return undefined;
  if (key.type === "Identifier") {
    return property.computed === true ? undefined : identifierName(key);
  }
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) {
    return String(key.value);
  }
  return undefined;
}

export function propertyValue(property: AstNode): AstNode | undefined {
  return asNode(property.value);
}

/** Object-literal entries, including spread elements. */
export function objectEntries(node: AstNode): AstNode[] {
  return nodeArray(node, "properties");
}

export function isCallTo(node: unknown, calleeName: string): node is AstNode {
  const candidate = asNode(node);
  if (!candidate || candidate.type !== "CallExpression") return false;
  return identifierName(candidate.callee) === calleeName;
}

export function callArguments(node: AstNode): AstNode[] {
  return nodeArray(node, "arguments");
}

const UNWRAPPED_EXPRESSIONS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ChainExpression",
]);

/** Strip parentheses and TypeScript-only wrappers from an expression. */
export function unwrapExpression(value: unknown): AstNode | undefined {
  let node = asNode(value);
  while (node && UNWRAPPED_EXPRESSIONS.has(node.type)) {
    node = asNode(node.expression);
  }
  return node;
}

/** A call expression after unwrapping parentheses/TS wrappers. */
export function callExpression(value: unknown): AstNode | undefined {
  const node = unwrapExpression(value);
  return node?.type === "CallExpression" ? node : undefined;
}

export function memberName(node: AstNode): string | undefined {
  if (node.type !== "MemberExpression") return undefined;
  if (node.computed === true) return literalString(node.property);
  return identifierName(node.property);
}
