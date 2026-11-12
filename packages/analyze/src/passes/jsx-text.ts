/**
 * Direct text/i18n facts for one page-preview node.
 *
 * The preview is schematic, not a render: reading only an element's own JSX children keeps a
 * section's label without pulling in what nested elements render. A `t("key")` child becomes
 * `tKey` (D-043) and literal text stays alongside it as the UI's fallback, because the UI
 * prefers the translated key. Dynamic expressions are skipped rather than guessed. Content
 * intrinsics (<input>, <img>, ...) carry their copy in an attribute instead of a child, so
 * `jsxContentFields` falls back to that attribute.
 */

import { asNode, memberName, nodeArray, unwrapExpression, type AstNode } from "../ast/node.ts";
import { jsxAttribute, jsxAttributeValue, jsxChildren } from "./jsx.ts";

/** The optional `PagePreviewNode` text fields; a field is omitted, never empty. */
export interface JsxTextFields {
  readonly text?: string;
  readonly tKey?: string;
}

/** JSX collapses source indentation into spaces; mirror it so labels carry no layout trivia. */
function collapseJsxText(value: string): string | undefined {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed === "" ? undefined : collapsed;
}

/** A string literal value, or undefined for any other expression. */
function literalText(node: AstNode): string | undefined {
  // oxc emits ESTree `Literal`; `StringLiteral` is accepted for parser independence.
  if (node.type !== "Literal" && node.type !== "StringLiteral") return undefined;
  return typeof node.value === "string" ? node.value : undefined;
}

/** A template literal without substitutions keeps its static text. */
function templateText(node: AstNode): string | undefined {
  if (nodeArray(node, "expressions").length > 0) return undefined;
  const quasi = nodeArray(node, "quasis")[0];
  const value = quasi?.value;
  if (typeof value !== "object" || value === null) return undefined;
  const cooked = (value as { cooked?: unknown }).cooked;
  if (typeof cooked === "string") return cooked;
  const raw = (value as { raw?: unknown }).raw;
  return typeof raw === "string" ? raw : undefined;
}

/** A direct text child: JSX text, or a static string/template expression. */
function textChild(child: AstNode): string | undefined {
  if (child.type === "JSXText") {
    return typeof child.value === "string" ? collapseJsxText(child.value) : undefined;
  }
  if (child.type !== "JSXExpressionContainer") return undefined;
  const expression = unwrapExpression(child.expression);
  if (expression === undefined) return undefined;
  const value =
    expression.type === "TemplateLiteral" ? templateText(expression) : literalText(expression);
  // A literal was authored as written, so only surrounding whitespace is dropped here.
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** A `t("key")` / `i18n.t("key")` child; the callee may be a member, the key may not be dynamic. */
function translationChild(child: AstNode): string | undefined {
  if (child.type !== "JSXExpressionContainer") return undefined;
  const call = unwrapExpression(child.expression);
  if (call === undefined || call.type !== "CallExpression") return undefined;
  const callee = asNode(call.callee);
  if (callee === undefined) return undefined;
  const calleeName = callee.type === "Identifier" ? callee.name : memberName(callee);
  if (calleeName !== "t") return undefined;
  const argument = nodeArray(call, "arguments")[0];
  const key = argument === undefined ? undefined : literalText(argument);
  return key === undefined || key.trim() === "" ? undefined : key;
}

/**
 * The first direct non-empty text child and the first direct `t("key")` child of an element.
 * Both are kept when the element renders one of each: the UI shows `tKey`, falling back to
 * `text`. Returns undefined when the element has neither, so callers emit no empty field.
 */
export function jsxTextFields(node: AstNode): JsxTextFields | undefined {
  let text: string | undefined;
  let tKey: string | undefined;
  for (const child of jsxChildren(node)) {
    text ??= textChild(child);
    tKey ??= translationChild(child);
  }
  if (text === undefined && tKey === undefined) return undefined;
  return { ...(text === undefined ? {} : { text }), ...(tKey === undefined ? {} : { tKey }) };
}

/** The attributes that stand in for missing JSX copy, in reading order per intrinsic. */
const COPY_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  input: ["placeholder", "aria-label", "value"],
  textarea: ["placeholder", "aria-label"],
  select: ["aria-label"],
  button: ["aria-label"],
  a: ["aria-label"],
  img: ["alt"],
};

const DEFAULT_COPY_ATTRIBUTES: readonly string[] = ["aria-label"];

/** An attribute value as static text: a string literal or a substitution-free template. */
function attributeText(attribute: AstNode | undefined): string | undefined {
  const expression = jsxAttributeValue(attribute);
  if (expression === undefined) return undefined;
  const value =
    expression.type === "TemplateLiteral" ? templateText(expression) : literalText(expression);
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/**
 * The copy a content intrinsic renders: its direct JSX text first (where `t("key")` becomes
 * `tKey`), then the first static placeholder/alt/aria-label attribute it carries. A dynamic
 * attribute never becomes copy, but does not hide a later static fallback either.
 */
export function jsxContentFields(node: AstNode, name: string): JsxTextFields | undefined {
  const fields = jsxTextFields(node);
  if (fields !== undefined) return fields;
  for (const attributeName of COPY_ATTRIBUTES[name] ?? DEFAULT_COPY_ATTRIBUTES) {
    const text = attributeText(jsxAttribute(node, attributeName));
    if (text !== undefined) return { text };
  }
  return undefined;
}
