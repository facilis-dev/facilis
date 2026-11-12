// Pure model for the page inspector's schematic "semi-render" (D-092 preview facts).
//
// The analyzer emits a flat, parented node list; the inspector draws it as a simplified page
// (device frame, bars, sections, lists with placeholder rows). This module owns the mapping
// from analysis facts to drawable blocks so the React layer stays a dumb renderer and the
// rules are unit-testable: intrinsic tags decide the block kind, t("key") children resolve
// against the project's locale catalogues, and conditional/map branches become placeholder
// repetitions instead of a single line of text.

import type { PagePreview, PagePreviewNode } from "@facilis.dev/analyze";

export type WireframeTag =
  | "bar"
  | "nav"
  | "main"
  | "section"
  | "list"
  | "action"
  | "field"
  | "media"
  | "component"
  | "slot"
  | "text"
  | "other";

/** One drawable block of the schematic page. */
export interface WireframeNode {
  readonly id: string;
  readonly tag: WireframeTag;
  /** Component name as written in the JSX (`TodoList`, `header`, `button`). */
  readonly label: string;
  /** Resolved copy for a text child, when the analyzer captured one. */
  readonly text: string | null;
  /**
   * Where the block is rendered (the JSX site): always present, and the click target. The
   * analyzer's `file` field is the component's *definition*, which can be a different file.
   */
  readonly file: string;
  readonly line: number;
  /** The component's defining file, when the analyzer resolved it (label hint only). */
  readonly definitionFile: string | null;
  /** True when the node sits under a conditional/map branch. */
  readonly dynamic: boolean;
  /** Placeholder rows to draw: a couple for lists, 2–3 for dynamic blocks, else 1. */
  readonly repeat: number;
  readonly children: readonly WireframeNode[];
}

export interface PageWireframe {
  readonly roots: readonly WireframeNode[];
  readonly count: number;
  readonly truncated: boolean;
}

/** Project locale catalogues (config locales), keyed by locale then flat message key. */
type Locales = Readonly<Record<string, Readonly<Record<string, string>>>>;

const INTRINSIC_TAGS: Readonly<Record<string, WireframeTag>> = {
  header: "bar",
  footer: "bar",
  nav: "nav",
  aside: "nav",
  main: "main",
  section: "section",
  article: "section",
  div: "section",
  form: "section",
  table: "section",
  ul: "list",
  ol: "list",
  li: "list",
  button: "action",
  a: "action",
  input: "field",
  select: "field",
  textarea: "field",
  label: "field",
  img: "media",
  picture: "media",
  video: "media",
  p: "text",
  h1: "text",
  h2: "text",
  h3: "text",
  h4: "text",
  h5: "text",
  h6: "text",
  span: "text",
  strong: "text",
  em: "text",
};

/** The block kind a preview node is drawn as. Never throws: unknown intrinsics are "other". */
export function wireframeTagOf(node: PagePreviewNode): WireframeTag {
  if (node.kind === "component") return "component";
  if (node.kind === "slot") return "slot";
  if (node.kind === "intrinsic") return INTRINSIC_TAGS[node.name.toLowerCase()] ?? "other";
  return "other";
}

/**
 * Resolve the copy a node contributes. A `t("key")` child wins over the literal source text:
 * the analyzer may capture the key plus a fallback literal, and the project locale catalogue
 * is what the real page would render. Missing keys fall back to English, then to nothing.
 */
function resolveText(
  node: PagePreviewNode,
  locales: Locales,
  defaultLocale: string | null,
): string | null {
  if (node.tKey) {
    const localized = defaultLocale === null ? undefined : locales[defaultLocale]?.[node.tKey];
    return localized ?? locales["en"]?.[node.tKey] ?? null;
  }
  return node.text ?? null;
}

/**
 * Lists always draw a couple of placeholder rows: the analyzer flattens <li> children away, so
 * a static list would otherwise read as one string. Dynamic branches get 2–3 rows (bounded).
 */
function repeatOf(tag: WireframeTag, dynamic: boolean, children: number): number {
  if (tag === "list") return dynamic ? 3 : 2;
  return dynamic ? Math.min(3, Math.max(2, children)) : 1;
}

export function buildPageWireframe(
  preview: PagePreview,
  locales: Locales,
  defaultLocale: string | null,
): PageWireframe {
  const childrenOf = new Map<string | null, PagePreviewNode[]>();
  const ids = new Set<string>();
  for (const node of preview.nodes) {
    ids.add(node.id);
    const siblings = childrenOf.get(node.parentId);
    if (siblings === undefined) childrenOf.set(node.parentId, [node]);
    else siblings.push(node);
  }

  const build = (node: PagePreviewNode, inheritedDynamic: boolean): WireframeNode => {
    const tag = wireframeTagOf(node);
    const dynamic = inheritedDynamic || node.dynamic;
    const children = (childrenOf.get(node.id) ?? []).map((child) => build(child, dynamic));
    return {
      id: node.id,
      tag,
      label: node.name,
      text: resolveText(node, locales, defaultLocale),
      // Open the rendering site, never the definition file at a usage line: the two only
      // coincide for the page's own root component.
      file: node.source.file,
      line: node.source.line,
      definitionFile: node.file,
      dynamic,
      repeat: repeatOf(tag, dynamic, children.length),
      children,
    };
  };

  // A node whose parent was cut off by the analyzer budget is promoted to a root rather than
  // dropped, so the wireframe never silently loses part of the page.
  const roots = preview.nodes
    .filter((node) => node.parentId === null || !ids.has(node.parentId))
    .map((node) => build(node, false));

  return { roots, count: preview.nodes.length, truncated: preview.truncated };
}
