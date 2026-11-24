/**
 * The docs content registry (example-local convention, issue #163).
 *
 * Content lives in src/content/docs as .md/.mdx files and is inlined as RAW text through
 * import.meta.glob. Raw imports are the whole trick: they work identically in the client
 * build and in the prerender engine's SSR sub-build, which loads no Vite config file
 * (D-202 Arm C) — a build-time content plugin such as @mdx-js/rollup would not run there.
 * Rendering therefore happens at React render time (markdown.ts / mdx.ts), which keeps
 * prerendered HTML and hydration byte-identical.
 *
 * Routing is file-derived: guides/navigation.mdx -> /docs/guides/navigation, and an
 * index file maps to its directory (index.md -> /docs, guides/index.md -> /docs/guides).
 * The sidebar tree, prev/next pager and section labels all derive from the same tree, so
 * adding a content file updates the whole site without editing React code.
 */

import { parseFrontmatter } from "./frontmatter.ts";

const rawDocs = import.meta.glob<string>("../content/docs/**/*.{md,mdx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

export type DocFormat = "md" | "mdx";

export interface DocEntry {
  /** URL path, e.g. "/docs/guides/navigation". */
  route: string;
  /** Path relative to the content root, e.g. "guides/navigation.mdx". */
  filePath: string;
  title: string;
  description: string | null;
  order: number | null;
  format: DocFormat;
  body: string;
}

export interface DocSection {
  /** Directory path relative to the content root; "" for the root. */
  key: string;
  label: string;
  /** The directory's index page, rendered first in the sidebar. */
  index: DocEntry | null;
  /** Non-index pages directly in this directory, in reading order. */
  pages: DocEntry[];
  sections: DocSection[];
}

export interface DocRegistry {
  tree: DocSection;
  byRoute: Map<string, DocEntry>;
  /** Reading order: section index, then its pages, then its subsections (depth first). */
  flat: DocEntry[];
}

const CONTENT_ROOT = "content/docs/";

/** "guides/navigation.mdx" -> "/docs/guides/navigation"; index files map to the directory. */
export function routeOf(filePath: string): string {
  const withoutExtension = filePath.replace(/\.(md|mdx)$/, "");
  const segments = withoutExtension.split("/");
  if (segments.at(-1) === "index") segments.pop();
  return segments.length === 0 ? "/docs" : "/docs/" + segments.join("/");
}

/** Fallback title when frontmatter has none: "content-pipeline" -> "Content Pipeline". */
export function titleFromPath(filePath: string): string {
  const withoutExtension = filePath.replace(/\.(md|mdx)$/, "");
  const segments = withoutExtension.split("/").filter((segment) => segment !== "index");
  const slug = segments.at(-1) ?? "docs";
  return slug
    .split(/[-_]/)
    .map((word) => (word === "" ? word : word[0]?.toUpperCase() + word.slice(1)))
    .join(" ");
}

function entryOf(filePath: string, source: string): DocEntry {
  const { data, body } = parseFrontmatter(source);
  return {
    route: routeOf(filePath),
    filePath,
    title: data.title ?? titleFromPath(filePath),
    description: data.description ?? null,
    order: data.order ?? null,
    format: filePath.endsWith(".mdx") ? "mdx" : "md",
    body,
  };
}

/** Pages sort by frontmatter order (absent order last), then alphabetically by title. */
function byReadingOrder(a: DocEntry, b: DocEntry): number {
  const orderA = a.order ?? Number.POSITIVE_INFINITY;
  const orderB = b.order ?? Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

function sectionOf(key: string): DocSection {
  const label = key === "" ? "Documentation" : titleFromPath(key + "/index.md");
  return { key, label, index: null, pages: [], sections: [] };
}

function childSection(parent: DocSection, name: string): DocSection {
  const key = parent.key === "" ? name : parent.key + "/" + name;
  const existing = parent.sections.find((section) => section.key === key);
  if (existing !== undefined) return existing;
  const created = sectionOf(key);
  parent.sections.push(created);
  return created;
}

function flatten(section: DocSection, into: DocEntry[]): void {
  if (section.index !== null) into.push(section.index);
  into.push(...section.pages);
  for (const child of section.sections) flatten(child, into);
}

/**
 * Build the registry from a path -> raw-source map. Pure, so tests can drive synthetic
 * trees; the module-level DOCS below feeds it the real content glob.
 */
export function buildDocTree(files: Record<string, string>): DocRegistry {
  const tree = sectionOf("");
  const byRoute = new Map<string, DocEntry>();
  for (const filePath of Object.keys(files).toSorted()) {
    const source = files[filePath];
    if (source === undefined) continue;
    const entry = entryOf(filePath, source);
    // A duplicate route (index.md AND index.mdx in one directory) keeps the first file in
    // sorted order: the site must stay deterministic instead of throwing on authored content.
    if (byRoute.has(entry.route)) continue;
    byRoute.set(entry.route, entry);
    const segments = filePath.split("/");
    const fileName = segments.pop() ?? filePath;
    let section = tree;
    for (const name of segments) section = childSection(section, name);
    if (fileName.replace(/\.(md|mdx)$/, "") === "index") section.index = entry;
    else section.pages.push(entry);
  }
  const sortSection = (section: DocSection): void => {
    section.pages.sort(byReadingOrder);
    if (section.index !== null) section.label = section.index.title;
    section.sections.sort((a, b) => {
      const orderA = a.index?.order ?? Number.POSITIVE_INFINITY;
      const orderB = b.index?.order ?? Number.POSITIVE_INFINITY;
      if (orderA !== orderB) return orderA - orderB;
      return a.label.localeCompare(b.label);
    });
    for (const child of section.sections) sortSection(child);
  };
  sortSection(tree);
  const flat: DocEntry[] = [];
  flatten(tree, flat);
  return { tree, byRoute, flat };
}

function contentFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [key, source] of Object.entries(rawDocs)) {
    const at = key.lastIndexOf(CONTENT_ROOT);
    if (at !== -1) files[key.slice(at + CONTENT_ROOT.length)] = source;
  }
  return files;
}

/** The one registry the whole site reads; rebuilt by Vite HMR when content files change. */
export const DOCS: DocRegistry = buildDocTree(contentFiles());

export function docByRoute(route: string): DocEntry | undefined {
  return DOCS.byRoute.get(route);
}

export function docTree(): DocSection {
  return DOCS.tree;
}

/** Prev/next in reading order; null at the ends of the docs sequence. */
export function docPager(route: string): { prev: DocEntry | null; next: DocEntry | null } {
  const at = DOCS.flat.findIndex((entry) => entry.route === route);
  if (at === -1) return { prev: null, next: null };
  return {
    prev: at > 0 ? (DOCS.flat[at - 1] ?? null) : null,
    next: at < DOCS.flat.length - 1 ? (DOCS.flat[at + 1] ?? null) : null,
  };
}
