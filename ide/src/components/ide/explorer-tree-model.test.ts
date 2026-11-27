import { describe, expect, it } from "vitest";
import {
  flattenTreeRows,
  isTreeNavigationKey,
  treeFocusIntent,
  treeItemAttributes,
  type TreeEntry,
  type TreeRoot,
} from "./explorer-tree-model";

const ROOTS: TreeRoot[] = [
  { id: "f1", rootPath: "/w/one" },
  { id: "f2", rootPath: "/w/two" },
];

const CHILDREN: Record<string, TreeEntry[]> = {
  "/w/one": [
    { name: "src", dir: true },
    { name: "README.md", dir: false },
  ],
  "/w/one/src": [
    { name: "app.tsx", dir: false },
    { name: "ui", dir: true },
  ],
  "/w/one/src/ui": [{ name: "button.tsx", dir: false }],
  "/w/two": [{ name: "package.json", dir: false }],
};

const ALL_EXPANDED = new Set(["/w/one", "/w/one/src", "/w/one/src/ui", "/w/two"]);

const ids = (expanded: Set<string>) => flattenTreeRows(ROOTS, CHILDREN, expanded).map((r) => r.id);

describe("flattenTreeRows", () => {
  it("lists the visible rows in render order, roots included", () => {
    expect(ids(ALL_EXPANDED)).toEqual([
      "/w/one",
      "/w/one/src",
      "/w/one/src/app.tsx",
      "/w/one/src/ui",
      "/w/one/src/ui/button.tsx",
      "/w/one/README.md",
      "/w/two",
      "/w/two/package.json",
    ]);
  });

  it("hides the children of a collapsed folder", () => {
    const expanded = new Set(ALL_EXPANDED);
    expanded.delete("/w/one/src");
    expect(ids(expanded)).toEqual([
      "/w/one",
      "/w/one/src",
      "/w/one/README.md",
      "/w/two",
      "/w/two/package.json",
    ]);
  });

  it("lists a folder whose children have not loaded yet as a row of its own", () => {
    const rows = flattenTreeRows(ROOTS, { "/w/one": [] }, new Set(["/w/one"]));
    expect(rows.map((r) => r.id)).toEqual(["/w/one", "/w/two"]);
  });

  it("records level, parent and the owning root for every row", () => {
    const rows = flattenTreeRows(ROOTS, CHILDREN, ALL_EXPANDED);
    expect(rows.map((r) => [r.id, r.level, r.parentId, r.rootId, r.root])).toEqual([
      ["/w/one", 1, null, "f1", true],
      ["/w/one/src", 2, "/w/one", "f1", false],
      ["/w/one/src/app.tsx", 3, "/w/one/src", "f1", false],
      ["/w/one/src/ui", 3, "/w/one/src", "f1", false],
      ["/w/one/src/ui/button.tsx", 4, "/w/one/src/ui", "f1", false],
      ["/w/one/README.md", 2, "/w/one", "f1", false],
      ["/w/two", 1, null, "f2", true],
      ["/w/two/package.json", 2, "/w/two", "f2", false],
    ]);
  });

  it("marks only expanded folders as expanded", () => {
    const rows = flattenTreeRows(ROOTS, CHILDREN, new Set(["/w/one"]));
    const expandedState = rows.map((r) => [r.id, r.isDir, r.expanded]);
    expect(expandedState).toEqual([
      ["/w/one", true, true],
      ["/w/one/src", true, false],
      ["/w/one/README.md", false, false],
      ["/w/two", true, false],
    ]);
  });

  it("returns no row at all for an empty workspace", () => {
    expect(flattenTreeRows([], CHILDREN, ALL_EXPANDED)).toEqual([]);
  });
});

describe("isTreeNavigationKey", () => {
  it("accepts the six navigation keys and nothing else", () => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(isTreeNavigationKey(key), key).toBe(true);
    }
    for (const key of ["Enter", "F2", "a", " ", "PageDown"]) {
      expect(isTreeNavigationKey(key), key).toBe(false);
    }
  });
});

describe("treeFocusIntent", () => {
  const rows = flattenTreeRows(ROOTS, CHILDREN, ALL_EXPANDED);
  const focus = (focusedId: string | null, key: string) => treeFocusIntent(rows, focusedId, key);

  it("moves down and up one visible row at a time", () => {
    expect(focus("/w/one", "ArrowDown")).toEqual({ focus: "/w/one/src" });
    expect(focus("/w/one/src/ui/button.tsx", "ArrowDown")).toEqual({ focus: "/w/one/README.md" });
    expect(focus("/w/one/src", "ArrowUp")).toEqual({ focus: "/w/one" });
  });

  it("stays put at the ends instead of wrapping", () => {
    expect(focus("/w/one", "ArrowUp")).toEqual({ focus: "/w/one" });
    expect(focus("/w/two/package.json", "ArrowDown")).toEqual({ focus: "/w/two/package.json" });
  });

  it("jumps to the first and last row with Home and End", () => {
    expect(focus("/w/one/src/ui", "Home")).toEqual({ focus: "/w/one" });
    expect(focus("/w/one", "End")).toEqual({ focus: "/w/two/package.json" });
  });

  it("expands a collapsed folder with ArrowRight, keeping focus on it", () => {
    const collapsed = flattenTreeRows(ROOTS, CHILDREN, new Set(["/w/one"]));
    expect(treeFocusIntent(collapsed, "/w/one/src", "ArrowRight")).toEqual({
      focus: "/w/one/src",
      expand: "/w/one/src",
    });
  });

  it("moves to the first child with ArrowRight on an expanded folder", () => {
    expect(focus("/w/one/src/ui", "ArrowRight")).toEqual({ focus: "/w/one/src/ui/button.tsx" });
  });

  it("stays on an expanded folder whose children are not loaded, and on any file", () => {
    const unloaded = flattenTreeRows(
      ROOTS,
      { "/w/one": [{ name: "empty", dir: true }] },
      new Set(["/w/one", "/w/one/empty"]),
    );
    expect(treeFocusIntent(unloaded, "/w/one/empty", "ArrowRight")).toEqual({
      focus: "/w/one/empty",
    });
    expect(focus("/w/two/package.json", "ArrowRight")).toEqual({
      focus: "/w/two/package.json",
    });
  });

  it("collapses an expanded folder with ArrowLeft, keeping focus on it", () => {
    expect(focus("/w/one/src", "ArrowLeft")).toEqual({
      focus: "/w/one/src",
      collapse: "/w/one/src",
    });
  });

  it("walks to the parent with ArrowLeft on a collapsed folder or a file", () => {
    expect(focus("/w/two/package.json", "ArrowLeft")).toEqual({ focus: "/w/two" });
    const collapsed = flattenTreeRows(ROOTS, CHILDREN, new Set(["/w/one"]));
    expect(treeFocusIntent(collapsed, "/w/one/src", "ArrowLeft")).toEqual({ focus: "/w/one" });
  });

  it("stays on a collapsed workspace root with ArrowLeft", () => {
    const collapsed = flattenTreeRows(ROOTS, CHILDREN, new Set(["/w/one"]));
    expect(treeFocusIntent(collapsed, "/w/two", "ArrowLeft")).toEqual({ focus: "/w/two" });
  });

  it("ignores keys that do not navigate the tree", () => {
    expect(focus("/w/one", "Enter")).toBeNull();
    expect(focus("/w/one", "F2")).toBeNull();
    expect(focus("/w/one", "a")).toBeNull();
  });

  it("recovers to the first row when the focused id is gone", () => {
    expect(focus("/w/one/removed.ts", "ArrowDown")).toEqual({ focus: "/w/one" });
    expect(treeFocusIntent(rows, null, "ArrowUp")).toEqual({ focus: "/w/one" });
  });

  it("returns null for an empty tree", () => {
    expect(treeFocusIntent([], "/w/one", "ArrowDown")).toBeNull();
  });
});

describe("treeItemAttributes", () => {
  it("announces role, level and selection, and only folders get an expanded state", () => {
    expect(treeItemAttributes({ focused: true, selected: true, level: 2, expanded: true })).toEqual(
      {
        role: "treeitem",
        "aria-level": 2,
        "aria-selected": true,
        "aria-expanded": true,
        tabIndex: 0,
      },
    );
    expect(treeItemAttributes({ focused: false, selected: false, level: 3 })).toEqual({
      role: "treeitem",
      "aria-level": 3,
      "aria-selected": false,
      tabIndex: -1,
    });
  });
});
