/**
 * Bounded static page structure for the page inspector: JSX sections nested one inside the
 * other, with component identifiers resolved through the module graph.
 *
 * This is not a rendering. It deliberately stops at explicit limits (depth, node count,
 * component cycles) and marks conditional/map branches as dynamic; anything outside the
 * bounded subset is omitted rather than guessed.
 */

import { asNode, nodeArray, unwrapExpression, type AstNode } from "../ast/node.ts";
import type { ModuleGraph } from "../module-graph.ts";
import type { PagePreview, PagePreviewNode } from "../types-graph.ts";
import { jsxTextFields, type JsxTextFields } from "./jsx-text.ts";
import {
  elementName,
  isSectionIntrinsic,
  jsxAttributeValue,
  jsxAttributes,
  jsxChildren,
  jsxElementValue,
} from "./jsx.ts";
import {
  canExpand,
  componentExpression,
  firstComponentName,
  lineRef,
  resolveComponent,
  returnedExpression,
} from "./screen-components.ts";

const MAX_NODES = 60;
const MAX_DEPTH = 4;

/** A route element, its source file and the child route that replaces its <Outlet>. */
export interface PreviewRoot {
  readonly element: AstNode;
  readonly originFile: string;
  readonly outletChild: PreviewRoot | null;
}

export interface PagePreviewInput {
  readonly graph: ModuleGraph;
  readonly pagePath: string;
  /** Route-table chain for this page; null for an unrouted page. */
  readonly root: PreviewRoot | null;
  /** Component name used when the page is not reached through the route table. */
  readonly pageName: string | null;
  readonly routePaths: readonly string[];
}

/** Build the bounded static structure for one page. */
export function buildPagePreview(input: PagePreviewInput): PagePreview {
  const { graph, pagePath } = input;
  const nodes: PagePreviewNode[] = [];
  const active = new Set<string>();
  let truncated = false;

  const addNode = (
    parentId: string | null,
    name: string,
    kind: PagePreviewNode["kind"],
    file: string | null,
    source: PagePreviewNode["source"],
    dynamic: boolean,
    text?: JsxTextFields,
  ): string | null => {
    if (nodes.length >= MAX_NODES) {
      truncated = true;
      return null;
    }
    const id = "p" + nodes.length;
    nodes.push({ id, parentId, name, kind, file, source, dynamic, ...text });
    return id;
  };

  const appendChildren = (
    node: AstNode,
    originFile: string,
    parentId: string | null,
    depth: number,
    dynamic: boolean,
    outletChild: PreviewRoot | null,
  ): void => {
    for (const child of jsxChildren(node)) {
      if (child.type === "JSXExpressionContainer") {
        appendExpression(
          asNode(child.expression),
          originFile,
          parentId,
          depth,
          dynamic,
          outletChild,
        );
      } else if (child.type === "JSXElement" || child.type === "JSXFragment") {
        appendJsx(child, originFile, parentId, depth, dynamic, outletChild);
      }
    }
  };

  const appendJsx = (
    node: AstNode,
    originFile: string,
    parentId: string | null,
    depth: number,
    dynamic: boolean,
    outletChild: PreviewRoot | null,
  ): void => {
    if (node.type === "JSXFragment") {
      appendChildren(node, originFile, parentId, depth, dynamic, outletChild);
      return;
    }
    const name = elementName(node);
    if (name === null) return;
    if (name === "Outlet") {
      if (outletChild !== null) {
        appendRoot(outletChild, parentId, depth, dynamic);
        return;
      }
      addNode(
        parentId,
        "Outlet",
        "slot",
        null,
        lineRef(graph, originFile, node),
        dynamic,
        jsxTextFields(node),
      );
      return;
    }
    const intrinsic = name[0] !== undefined && name[0] === name[0].toLowerCase();
    if (intrinsic) {
      if (!isSectionIntrinsic(name)) {
        appendChildren(node, originFile, parentId, depth, dynamic, outletChild);
        return;
      }
      const id = addNode(
        parentId,
        name,
        "intrinsic",
        null,
        lineRef(graph, originFile, node),
        dynamic,
        jsxTextFields(node),
      );
      if (id !== null) appendChildren(node, originFile, id, depth + 1, dynamic, outletChild);
      return;
    }
    const ref = resolveComponent(graph, originFile, name);
    const id = addNode(
      parentId,
      name,
      "component",
      ref?.file ?? null,
      lineRef(graph, originFile, node),
      dynamic,
      jsxTextFields(node),
    );
    if (id === null) return;
    // JSX-valued props are real sections too (AuthShell footer, Page actions, ...).
    for (const attribute of jsxAttributes(node)) {
      if (attribute.type !== "JSXAttribute") continue;
      const value = jsxElementValue(jsxAttributeValue(attribute));
      if (value === undefined) continue;
      const attributeName = asNode(attribute.name);
      const slotName =
        attributeName !== undefined && typeof attributeName.name === "string"
          ? attributeName.name
          : "slot";
      const slotId = addNode(id, slotName, "slot", null, lineRef(graph, originFile, node), dynamic);
      if (slotId !== null) appendJsx(value, originFile, slotId, depth + 1, dynamic, null);
    }
    // The component's own JSX children are its content slot; keep them visible even when the
    // component definition is expanded (its `{children}` expression is not JSX we can splice).
    appendChildren(node, originFile, id, depth + 1, dynamic, null);
    const expand = ref !== null && canExpand(ref.file) && depth < MAX_DEPTH;
    if (!expand) return;
    const key = ref.file + "#" + ref.name;
    const expression = active.has(key) ? undefined : componentExpression(graph, ref.file, ref.name);
    if (expression === undefined) return;
    active.add(key);
    appendExpression(expression, ref.file, id, depth + 1, dynamic, outletChild);
    active.delete(key);
  };

  const appendExpression = (
    node: AstNode | undefined,
    originFile: string,
    parentId: string | null,
    depth: number,
    dynamic: boolean,
    outletChild: PreviewRoot | null,
  ): void => {
    if (node === undefined) return;
    const expression = unwrapExpression(node) ?? node;
    if (expression.type === "JSXElement" || expression.type === "JSXFragment") {
      appendJsx(expression, originFile, parentId, depth, dynamic, outletChild);
      return;
    }
    if (expression.type === "ConditionalExpression") {
      appendExpression(
        asNode(expression.consequent),
        originFile,
        parentId,
        depth,
        true,
        outletChild,
      );
      appendExpression(
        asNode(expression.alternate),
        originFile,
        parentId,
        depth,
        true,
        outletChild,
      );
      return;
    }
    if (expression.type === "LogicalExpression") {
      appendExpression(asNode(expression.right), originFile, parentId, depth, true, outletChild);
      return;
    }
    if (expression.type === "ArrayExpression") {
      for (const element of nodeArray(expression, "elements")) {
        appendExpression(element, originFile, parentId, depth, dynamic, outletChild);
      }
      return;
    }
    if (expression.type === "CallExpression") {
      const callee = asNode(expression.callee);
      const property =
        callee === undefined || callee.type !== "MemberExpression"
          ? undefined
          : asNode(callee.property);
      if (property !== undefined && typeof property.name === "string" && property.name === "map") {
        const callback = nodeArray(expression, "arguments")[0];
        const body = callback === undefined ? undefined : asNode(callback.body);
        const returned =
          body === undefined
            ? undefined
            : body.type === "BlockStatement"
              ? returnedExpression(body)
              : body;
        appendExpression(returned, originFile, parentId, depth, true, outletChild);
      }
    }
  };

  const appendRoot = (
    root: PreviewRoot | null,
    parentId: string | null,
    depth: number,
    dynamic: boolean,
  ): void => {
    if (root === null) return;
    appendExpression(root.element, root.originFile, parentId, depth, dynamic, root.outletChild);
  };

  if (input.root !== null) {
    appendRoot(input.root, null, 0, false);
  } else if (input.pageName !== null) {
    const file = graph.file(pagePath);
    if (file !== undefined) {
      const id = addNode(
        null,
        input.pageName,
        "component",
        pagePath,
        lineRef(graph, pagePath, file.program),
        false,
      );
      const expression =
        id === null ? undefined : componentExpression(graph, pagePath, input.pageName);
      if (id !== null && expression !== undefined)
        appendExpression(expression, pagePath, id, 1, false, null);
    }
  }

  return { routePaths: input.routePaths, nodes, truncated };
}

export function pageComponentName(graph: ModuleGraph, pagePath: string): string | null {
  return firstComponentName(graph, pagePath);
}
