/**
 * Small ESTree/JSX helpers shared by the route-table and page-preview passes.
 *
 * The analyzer's parser contract is parser-independent ESTree, so these helpers only read
 * structural keys (`openingElement.name`, `attributes`, `children`, `expression`); they never
 * execute project code and never depend on oxc-specific node types.
 */

import { asNode, nodeArray, type AstNode } from "../ast/node.ts";

/** `JSXIdentifier` / `JSXMemberExpression` / `JSXNamespacedName` -> display name. */
export function jsxName(node: AstNode | undefined): string | null {
  if (node === undefined) return null;
  if (node.type === "JSXIdentifier") return typeof node.name === "string" ? node.name : null;
  if (node.type === "JSXMemberExpression") {
    const object = jsxName(asNode(node.object));
    const property = jsxName(asNode(node.property));
    return object === null || property === null ? null : object + "." + property;
  }
  if (node.type === "JSXNamespacedName") {
    const namespace = jsxName(asNode(node.namespace));
    const name = jsxName(asNode(node.name));
    return namespace === null || name === null ? null : namespace + ":" + name;
  }
  return null;
}

export function openingElement(node: AstNode): AstNode | undefined {
  return node.type === "JSXElement" ? asNode(node.openingElement) : undefined;
}

export function elementName(node: AstNode): string | null {
  return jsxName(asNode(openingElement(node)?.name));
}

export function jsxChildren(node: AstNode): AstNode[] {
  return nodeArray(node, "children");
}

export function jsxAttributes(node: AstNode): AstNode[] {
  const opening = openingElement(node);
  return opening === undefined ? [] : nodeArray(opening, "attributes");
}

/** The first attribute with this name, or undefined. */
export function jsxAttribute(node: AstNode, name: string): AstNode | undefined {
  for (const attribute of jsxAttributes(node)) {
    if (attribute.type !== "JSXAttribute") continue;
    if (jsxName(asNode(attribute.name)) === name) return attribute;
  }
  return undefined;
}

/** The value expression of an attribute, unwrapped from `JSXExpressionContainer`. */
export function jsxAttributeValue(attribute: AstNode | undefined): AstNode | undefined {
  if (attribute === undefined) return undefined;
  const value = asNode(attribute.value);
  if (value === undefined) return undefined;
  if (value.type === "JSXExpressionContainer") return asNode(value.expression);
  return value;
}

/** A JSX element/fragment value, when the expression is one. */
export function jsxElementValue(value: AstNode | undefined): AstNode | undefined {
  if (value === undefined) return undefined;
  if (value.type === "JSXElement" || value.type === "JSXFragment") return value;
  return undefined;
}

export function isJsxElement(node: AstNode | undefined): node is AstNode {
  return node !== undefined && (node.type === "JSXElement" || node.type === "JSXFragment");
}

/** JSX elements that carry a page section (`<div>`/`<span>` are flattened away). */
const SECTION_INTRINSICS = new Set([
  "header",
  "main",
  "section",
  "nav",
  "aside",
  "footer",
  "form",
  "table",
  "ul",
  "h1",
  "h2",
  "h3",
]);

export function isSectionIntrinsic(name: string): boolean {
  return SECTION_INTRINSICS.has(name);
}
