// Pure model for the page miniature drawn on a page card and in the inspector (D-176).
//
// D-170 drew the analyzer's bounded component tree as nested labelled boxes; the owner rejected
// that as the component structure it is ("inutile e troppo dispersiva"). This model instead reads
// the same bounded tree for what a screenshot shows at a glance — the page's shell (a top bar, a
// side rail) and the coarse visual regions its facts can prove (a form, a list, media, copy,
// component cards, conditional branches) — and returns a handful of blocks to lay out as a fixed
// two-pane page. It is a miniature, never a hierarchy: labels are dropped at this size, which is
// exactly what keeps it from becoming the tree again.

import type { PagePreview, PagePreviewNode } from "@facilis.dev/analyze";

/** One drawable region of the miniature. */
export type SketchBlockKind = "action" | "board" | "branch" | "form" | "list" | "media" | "text";

export interface SketchBlock {
  readonly kind: SketchBlockKind;
  /** Relative height: the renderer grows each block by this weight inside the content area. */
  readonly weight: number;
}

export interface PageSketch {
  /** The page renders a header bar (header/footer intrinsics or slots). */
  readonly header: boolean;
  /** The page has a side rail (an aside, or a nav outside the header). */
  readonly rail: boolean;
  readonly blocks: readonly SketchBlock[];
  /** The analyzer's own node budget cut the structure: the miniature shows only what it has. */
  readonly truncated: boolean;
}

/** A region is capped so the thumbnail keeps reading at card size, not just in the inspector. */
const MAX_BLOCKS = 4;

/**
 * Shell detection only trusts the outer part of the tree: a card header deep inside the content
 * is not the page header. Three levels reach the layout wrappers every page in the template uses
 * (AppLayout to aside/header, PublicOnly to AuthLayout to aside) while ignoring inner components.
 */
const SHELL_DEPTH = 3;

/** The bounded preview is at most four levels deep; this only guards the flattening recursion. */
const MAX_CONTENT_DEPTH = 6;

const WEIGHT: Readonly<Record<SketchBlockKind, number>> = {
  action: 1,
  text: 2,
  branch: 3,
  form: 3,
  media: 3,
  board: 4,
  list: 4,
};

/** Elements that are page chrome rather than content: the shell draws them, the content skips them. */
const CHROME_NAMES = new Set(["header", "nav", "aside", "footer"]);

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

/** Copy-bearing intrinsics; the analyzer only emits them when they carry readable copy (D-170). */
const COPY_NAMES = new Set([
  "p",
  "span",
  "strong",
  "em",
  "small",
  "b",
  "i",
  "code",
  "pre",
  "blockquote",
]);

interface SketchNode {
  readonly node: PagePreviewNode;
  readonly children: readonly SketchNode[];
}

/** A content signal before grouping: field is not a region of its own, it joins its action. */
type SignalKind = SketchBlockKind | "field";

interface Signal {
  readonly kind: SignalKind;
  readonly dynamic: boolean;
}

function nameOf(node: PagePreviewNode): string {
  return node.name.toLowerCase();
}

function isChrome(node: PagePreviewNode): boolean {
  return (node.kind === "intrinsic" || node.kind === "slot") && CHROME_NAMES.has(nameOf(node));
}

function isOverlay(node: PagePreviewNode): boolean {
  return node.kind === "component" && OVERLAY_NAMES.has(nameOf(node));
}

/** Components are drawn as blocks, but icons are decoration: drawing each one adds noise. */
function isDecoration(node: PagePreviewNode): boolean {
  return node.kind === "component" && nameOf(node).startsWith("icon");
}

/** Parented flat list to tree. Orphans (a cut-off parent) are promoted to roots, never dropped. */
function treeOf(nodes: readonly PagePreviewNode[]): readonly SketchNode[] {
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

function shellOf(roots: readonly SketchNode[]): { header: boolean; rail: boolean } {
  let header = false;
  let rail = false;
  const visit = (tree: SketchNode, depth: number, parentName: string | null): void => {
    const { node } = tree;
    if (isChrome(node)) {
      const name = nameOf(node);
      // A footer is chrome the miniature omits; only a header earns the top bar.
      if (name === "header") header = true;
      else if (name === "aside" || (name === "nav" && parentName !== "header")) rail = true;
    }
    if (depth >= SHELL_DEPTH) return;
    for (const child of tree.children) visit(child, depth + 1, nameOf(node));
  };
  for (const root of roots) visit(root, 0, null);
  return { header, rail };
}

/**
 * What the element contributes to the miniature, if anything. Returning a block stops the walk:
 * a form's controls or a button's icon are inside the region the block already represents.
 */
function signalOf(node: PagePreviewNode): SignalKind | null {
  if (node.kind !== "intrinsic") return null;
  const name = nameOf(node);
  if (name === "form") return "form";
  if (name === "table" || name === "ul" || name === "ol") return "list";
  if (name === "button" || name === "a") return "action";
  if (name === "input" || name === "select" || name === "textarea" || name === "label")
    return "field";
  if (name === "img" || name === "picture" || name === "video" || name === "audio") return "media";
  if (/^h[1-3]$/.test(name)) return "text";
  if (COPY_NAMES.has(name) && (node.text !== undefined || node.tKey !== undefined)) return "text";
  return null;
}

function collect(tree: SketchNode, dynamic: boolean, out: Signal[], depth: number): void {
  const { node } = tree;
  if (isChrome(node) || isOverlay(node) || isDecoration(node)) return;
  const inherited = dynamic || node.dynamic;
  const signal = signalOf(node);
  if (signal !== null) {
    out.push({ kind: signal, dynamic: inherited });
    return;
  }
  const children = tree.children.filter(
    (child) => !isChrome(child.node) && !isOverlay(child.node) && !isDecoration(child.node),
  );
  if (children.length === 0) {
    // A component with no expanded children is still a region: the card says "something renders
    // here" without guessing what.
    if (node.kind === "component") out.push({ kind: "board", dynamic: inherited });
    return;
  }
  if (depth >= MAX_CONTENT_DEPTH) {
    if (node.kind === "component") out.push({ kind: "board", dynamic: inherited });
    return;
  }
  for (const child of children) collect(child, inherited, out, depth + 1);
}

function blockOf(kind: SketchBlockKind): SketchBlock {
  return { kind, weight: WEIGHT[kind] };
}

/** Signals to at most MAX_BLOCKS drawable regions, merging what belongs together. */
function blocksOf(signals: readonly Signal[]): readonly SketchBlock[] {
  const blocks: SketchBlock[] = [];
  let index = 0;
  let sawDynamic = false;
  while (index < signals.length && blocks.length < MAX_BLOCKS) {
    const signal = signals[index];
    if (signal.dynamic) {
      let end = index;
      while (end < signals.length && signals[end].dynamic) end += 1;
      sawDynamic = true;
      // One conditional is noise (an alert, a retry link); a run of alternatives is a real region
      // — the loading/error/ready branches of a data page occupy the same part of the screen.
      if (end - index >= 2) blocks.push(blockOf("branch"));
      index = end;
      continue;
    }
    if (signal.kind === "field") {
      // Inputs and the submit/action that follows them are one visual region.
      let end = index;
      while (
        end < signals.length &&
        !signals[end].dynamic &&
        (signals[end].kind === "field" || signals[end].kind === "action")
      )
        end += 1;
      blocks.push(blockOf("form"));
      index = end;
      continue;
    }
    if (signal.kind === "action") {
      blocks.push(blockOf("action"));
      index += 1;
      continue;
    }
    if (signal.kind === "text") {
      let end = index;
      while (end < signals.length && !signals[end].dynamic && signals[end].kind === "text")
        end += 1;
      blocks.push(blockOf("text"));
      index = end;
      continue;
    }
    blocks.push(blockOf(signal.kind));
    index += 1;
  }
  if (blocks.length > 0) return blocks;
  // Nothing drawable but a conditional exists: draw the branch rather than an empty page.
  if (sawDynamic) return [blockOf("branch")];
  return [blockOf("text")];
}

/** Build the miniature for one page preview. Pure and deterministic. */
export function buildPageSketch(preview: PagePreview): PageSketch {
  const roots = treeOf(preview.nodes);
  const { header, rail } = shellOf(roots);
  const signals: Signal[] = [];
  for (const root of roots) collect(root, false, signals, 0);
  return { header, rail, blocks: blocksOf(signals), truncated: preview.truncated };
}
