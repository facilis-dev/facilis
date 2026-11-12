// Node predicates and tree rebuilding behind the page miniature (D-176, D-178).
//
// The analyzer hands the preview to the IDE as a flat parented list. Everything the miniature
// needs to know about one node — is it chrome, an overlay, a decoration, a control — is answered
// here, so the sketch model keeps talking about page regions instead of node bookkeeping.

import type { PagePreviewNode } from "@facilis.dev/analyze";

export interface SketchNode {
  readonly node: PagePreviewNode;
  readonly children: readonly SketchNode[];
}

export function nameOf(node: PagePreviewNode): string {
  return node.name.toLowerCase();
}

/** Elements that are page chrome rather than content: the shell draws them, the content skips them. */
const CHROME_NAMES = new Set(["header", "nav", "aside", "footer"]);

export function isChrome(node: PagePreviewNode): boolean {
  return (node.kind === "intrinsic" || node.kind === "slot") && CHROME_NAMES.has(nameOf(node));
}

/**
 * Overlays are part of the page only once opened, so a resting page screenshot never shows them.
 * Matched by component name because the analyzer reports a component, not its behavior.
 */
const OVERLAY_NAMES = new Set([
  "alertdialog",
  "dialog",
  "drawer",
  "modal",
  "popover",
  "sheet",
  "sonner",
  "toast",
  "tooltip",
]);

export function isOverlay(node: PagePreviewNode): boolean {
  return node.kind === "component" && OVERLAY_NAMES.has(nameOf(node));
}

/** Components are drawn as blocks, but icons are decoration: drawing each one adds noise. */
export function isDecoration(node: PagePreviewNode): boolean {
  return node.kind === "component" && nameOf(node).startsWith("icon");
}

/** Parented flat list to tree. Orphans (a cut-off parent) are promoted to roots, never dropped. */
export function treeOf(nodes: readonly PagePreviewNode[]): readonly SketchNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  const childrenOf = new Map<string, PagePreviewNode[]>();
  const roots: PagePreviewNode[] = [];
  for (const node of nodes) {
    if (node.parentId === null || !ids.has(node.parentId)) {
      roots.push(node);
      continue;
    }
    const siblings = childrenOf.get(node.parentId);
    if (siblings === undefined) childrenOf.set(node.parentId, [node]);
    else siblings.push(node);
  }
  const build = (node: PagePreviewNode): SketchNode => ({
    node,
    children: (childrenOf.get(node.id) ?? []).map(build),
  });
  return roots.map(build);
}

/**
 * Names that render one control row. The list is small and template-shaped on purpose: a field
 * wrapper and the control it wraps are the same row, never two (see `countFields`).
 */
const FIELD_NAMES = new Set([
  "input",
  "select",
  "textarea",
  "field",
  "combobox",
  "checkbox",
  "switch",
  "slider",
  "date-picker",
  "radio-group",
]);

function isField(node: PagePreviewNode): boolean {
  return (node.kind === "intrinsic" || node.kind === "component") && FIELD_NAMES.has(nameOf(node));
}

/**
 * The control rows a form proves. The walk stops at the first field: `Field > Input` is one row,
 * so a labelled control is not drawn twice; a form whose children the budget cut counts zero and
 * the caller still draws its minimum row.
 */
export function countFields(tree: SketchNode): number {
  let count = 0;
  const visit = (current: SketchNode): void => {
    if (isField(current.node)) {
      count += 1;
      return;
    }
    for (const child of current.children) visit(child);
  };
  visit(tree);
  return count;
}

/** The template's auth card keeps a footer link under the form; it is copy, not a region. */
export function hasFooterSlot(nodes: readonly PagePreviewNode[]): boolean {
  return nodes.some((node) => node.kind === "slot" && nameOf(node) === "footer");
}
