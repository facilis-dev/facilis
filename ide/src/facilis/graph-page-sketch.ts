// Pure model for the page miniature drawn on a page card and in the inspector (D-176, D-178).
//
// D-170 drew the analyzer's bounded component tree as nested labelled boxes; the owner rejected
// that as the component structure it is ("inutile e troppo dispersiva"). This model instead reads
// the same bounded tree for what a screenshot shows at a glance — the page kind (a split auth
// screen, an app shell, a bare page), the shell and the coarse visual regions its facts can prove
// (a form, a list, media, copy, component cards, conditional branches) — and returns a handful of
// blocks to lay out as that kind of page. It is a miniature, never a hierarchy: labels are dropped
// at this size, which is exactly what keeps it from becoming the tree again.

import type { PagePreview, PagePreviewNode } from "@facilis.dev/analyze";
import { classifyPageLayout, type SketchLayout } from "./graph-page-layout";
import {
  countFields,
  hasFooterSlot,
  isChrome,
  isDecoration,
  isOverlay,
  nameOf,
  treeOf,
  type SketchNode,
} from "./graph-page-nodes";

/** One drawable region of the miniature. */
export type SketchBlockKind =
  "action" | "board" | "branch" | "form" | "heading" | "list" | "media" | "text";

export interface SketchBlock {
  readonly kind: SketchBlockKind;
  /** Relative height: the renderer grows each block by this weight inside its layout. */
  readonly weight: number;
  /** Form regions only: the control rows the preview proves, already capped for the miniature. */
  readonly fields?: number;
}

export interface PageSketch {
  /** The page kind the miniature draws; the shell flags only apply to an app page. */
  readonly layout: SketchLayout;
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

/** Enough rows to tell "email, password, submit" from a single search field. */
const MAX_FORM_ROWS = 3;

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
  heading: 2,
  text: 2,
  branch: 3,
  form: 3,
  media: 3,
  board: 4,
  list: 4,
};

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

/** A content signal before grouping: field is not a region of its own, it joins its action. */
type SignalKind = SketchBlockKind | "field";

interface Signal {
  readonly kind: SignalKind;
  readonly dynamic: boolean;
  /** Form signals only: rows proven inside the form. */
  readonly fields?: number;
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
    if (signal === "form") {
      out.push({ kind: signal, dynamic: inherited, fields: rowsOf(tree) });
    } else {
      out.push({ kind: signal, dynamic: inherited });
    }
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

/** One control row minimum: the analyzer may have cut a form before its children. */
function rowsOf(form: SketchNode): number {
  return Math.min(Math.max(countFields(form), 1), MAX_FORM_ROWS);
}

function blockOf(kind: SketchBlockKind): SketchBlock {
  return { kind, weight: WEIGHT[kind] };
}

function formBlockOf(fields: number | undefined): SketchBlock {
  return { kind: "form", weight: WEIGHT.form, fields };
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
      let fields = 0;
      while (
        end < signals.length &&
        !signals[end].dynamic &&
        (signals[end].kind === "field" || signals[end].kind === "action")
      ) {
        if (signals[end].kind === "field") fields += 1;
        end += 1;
      }
      blocks.push(formBlockOf(Math.min(Math.max(fields, 1), MAX_FORM_ROWS)));
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
    if (signal.kind === "form") {
      blocks.push(formBlockOf(signal.fields));
      index += 1;
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

/**
 * An auth screen is not an app page: the template splits it into a brand panel and a centred card
 * holding a heading, the form and a footer link. The heading is structural (every auth card opens
 * with one) even though its text arrives through props; the footer is the link to the sibling
 * screen, so it reads as one small action rather than as copy.
 */
function authBlocksOf(preview: PagePreview, signals: readonly Signal[]): readonly SketchBlock[] {
  const form = signals.find((signal) => signal.kind === "form");
  const blocks: SketchBlock[] = [blockOf("heading")];
  if (form === undefined) blocks.push(...blocksOf(signals));
  else blocks.push(formBlockOf(form.fields));
  if (hasFooterSlot(preview.nodes)) blocks.push(blockOf("action"));
  return blocks.slice(0, MAX_BLOCKS);
}

/** Build the miniature for one page preview. Pure and deterministic. */
export function buildPageSketch(preview: PagePreview): PageSketch {
  const roots = treeOf(preview.nodes);
  const shell = shellOf(roots);
  const layout = classifyPageLayout(preview, shell);
  const signals: Signal[] = [];
  for (const root of roots) collect(root, false, signals, 0);
  return {
    layout,
    header: layout === "app" && shell.header,
    rail: layout === "app" && shell.rail,
    blocks: layout === "auth" ? authBlocksOf(preview, signals) : blocksOf(signals),
    truncated: preview.truncated,
  };
}
