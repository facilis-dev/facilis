/**
 * Minimal ESTree narrowing helpers.
 *
 * rolldown's `parseSync` returns the oxc AST as plain objects. We never build a
 * full visitor: the AST pass only needs to find one top-level call and read
 * object literals, so a handful of total helpers keeps the code reviewable.
 */
export interface AstNode {
  type: string;
  [key: string]: unknown;
}

export function isAstNode(value: unknown): value is AstNode {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string";
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

/** Name of an object-literal property, or undefined for computed/spread entries. */
export function propertyName(property: AstNode): string | undefined {
  if (property.type !== "Property") return undefined;
  const key = asNode(property.key);
  if (!key) return undefined;
  if (key.type === "Identifier") {
    return property.computed === true ? undefined : identifierName(key);
  }
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) {
    // Computed string literals (`["dbTables"]: ...`) are still static.
    return String(key.value);
  }
  return undefined;
}

export function propertyValue(property: AstNode): AstNode | undefined {
  return asNode(property.value);
}

/** True when `node` is a call expression whose callee is the given bare identifier. */
export function isCallTo(node: unknown, calleeName: string): node is AstNode {
  const candidate = asNode(node);
  if (!candidate || candidate.type !== "CallExpression") return false;
  return identifierName(candidate.callee) === calleeName;
}

export function callArguments(node: AstNode): AstNode[] {
  const args = node.arguments;
  if (!Array.isArray(args)) return [];
  return args.filter(isAstNode);
}
