// The Explorer's keyboard model: which rows are visible and where a navigation key
// moves the roving focus. Deliberately free of React and the DOM so the tree rules
// can be unit-tested (the IDE ships no jsdom); Explorer.tsx only renders the result.
//
// Rows are the FLATTENED list of what is currently on screen, workspace roots
// included: to the keyboard a root is a row like any other, even though it is never
// part of the file selection (deleting a workspace root is not a file operation).

export interface TreeEntry {
  name: string;
  dir: boolean;
}

export interface TreeRoot {
  id: string;
  rootPath: string;
}

export interface TreeRow {
  /** Absolute path — the row's identity across renders. */
  id: string;
  /** Id of the workspace folder that owns the row. */
  rootId: string;
  isDir: boolean;
  /** 1-based depth, as announced by `aria-level`: a workspace root is level 1. */
  level: number;
  /** The parent row's id, or null for a workspace root. */
  parentId: string | null;
  expanded: boolean;
  /** Workspace roots are focusable but excluded from the file selection. */
  root: boolean;
}

/** The rows currently visible, in render order, root by root. */
export function flattenTreeRows(
  roots: readonly TreeRoot[],
  children: Readonly<Record<string, readonly TreeEntry[]>>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  // A collapsed folder hides its subtree; a folder whose children have not loaded
  // yet contributes only its own row.
  const walk = (dir: string, rootId: string, level: number, parentId: string) => {
    for (const entry of children[dir] ?? []) {
      const id = dir + "/" + entry.name;
      const isOpen = entry.dir && expanded.has(id);
      rows.push({
        id,
        rootId,
        isDir: entry.dir,
        level,
        parentId,
        expanded: isOpen,
        root: false,
      });
      if (isOpen) walk(id, rootId, level + 1, id);
    }
  };
  for (const root of roots) {
    const isOpen = expanded.has(root.rootPath);
    rows.push({
      id: root.rootPath,
      rootId: root.id,
      isDir: true,
      level: 1,
      parentId: null,
      expanded: isOpen,
      root: true,
    });
    if (isOpen) walk(root.rootPath, root.id, 2, root.rootPath);
  }
  return rows;
}

export type TreeNavigationKey =
  "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function isTreeNavigationKey(key: string): key is TreeNavigationKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "Home" ||
    key === "End"
  );
}

export interface TreeFocusIntent {
  /** The row that should hold the roving focus after the key. */
  focus: string;
  /** Folder to expand first (ArrowRight on a collapsed folder). */
  expand?: string;
  /** Folder to collapse first (ArrowLeft on an expanded folder). */
  collapse?: string;
}

/**
 * Where a navigation key moves the focus, and which folder it opens or closes on the
 * way. Returns null for keys the tree does not navigate with. A focus id that is no
 * longer visible (collapsed, deleted, renamed) recovers to the first row, so the
 * tree never loses its tab stop.
 */
export function treeFocusIntent(
  rows: readonly TreeRow[],
  focusedId: string | null,
  key: string,
): TreeFocusIntent | null {
  if (!isTreeNavigationKey(key) || rows.length === 0) return null;
  const index = rows.findIndex((row) => row.id === focusedId);
  if (index === -1) return { focus: rows[0].id };
  const row = rows[index];
  switch (key) {
    case "ArrowUp":
      return { focus: (index > 0 ? rows[index - 1] : row).id };
    case "ArrowDown":
      return { focus: (index < rows.length - 1 ? rows[index + 1] : row).id };
    case "Home":
      return { focus: rows[0].id };
    case "End":
      return { focus: rows[rows.length - 1].id };
    case "ArrowRight": {
      if (!row.isDir) return { focus: row.id };
      if (!row.expanded) return { focus: row.id, expand: row.id };
      const child = rows[index + 1];
      return { focus: child?.level === row.level + 1 ? child.id : row.id };
    }
    case "ArrowLeft":
      return row.isDir && row.expanded
        ? { focus: row.id, collapse: row.id }
        : { focus: row.parentId ?? row.id };
  }
}

export interface TreeItemState {
  /** Whether this row holds the tree's single roving tab stop. */
  focused: boolean;
  selected: boolean;
  level: number;
  /** Only folders carry expansion state; a file must not announce one. */
  expanded?: boolean;
}

export interface TreeItemAttributes {
  role: "treeitem";
  "aria-level": number;
  "aria-selected": boolean;
  "aria-expanded"?: boolean;
  tabIndex: 0 | -1;
}

/** The ARIA/roving-tabindex attributes a tree row is rendered with. */
export function treeItemAttributes({
  focused,
  selected,
  level,
  expanded,
}: TreeItemState): TreeItemAttributes {
  return {
    role: "treeitem",
    "aria-level": level,
    "aria-selected": selected,
    tabIndex: focused ? 0 : -1,
    ...(expanded === undefined ? {} : { "aria-expanded": expanded }),
  };
}
