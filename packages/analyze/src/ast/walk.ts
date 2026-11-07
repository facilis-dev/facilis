import { isAstNode, type AstNode } from "./node.ts";

const SKIPPED_KEYS = new Set(["type", "start", "end", "range"]);

/**
 * Depth-first walk over an ESTree node. The AST is plain data (no cycles), so a generic
 * recursion is enough and keeps the analyzer independent of a parser-specific visitor.
 */
export function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) walk(child, visit);
      }
      continue;
    }
    if (isAstNode(value)) walk(value, visit);
  }
}

/** Visit descendants of a node, not the node itself. */
export function walkChildren(node: AstNode, visit: (node: AstNode) => void): void {
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) walk(child, visit);
      }
      continue;
    }
    if (isAstNode(value)) walk(value, visit);
  }
}
