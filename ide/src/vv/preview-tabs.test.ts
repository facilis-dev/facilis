import { describe, expect, it } from "vitest";
import type { PreviewTab } from "./preview-session";
import { closedOtherTabs, closedTab, closedTabsToRight, previewTabForPort } from "./preview-tabs";

function tab(id: string): PreviewTab {
  return { id, url: "localhost:5173", path: "/", port: 5173, nonce: 1 };
}

const TABS = [tab("a"), tab("b"), tab("c")];

describe("previewTabForPort", () => {
  it("binds a tab that is waiting for a server, keeping its path and reloading it", () => {
    const pending: PreviewTab = { id: "pv9", url: "", port: null, path: "/todos/1", nonce: 2 };
    const next = previewTabForPort([pending], 3000, () => "unused");
    expect(next).toEqual({
      tabs: [{ ...pending, url: "localhost:3000", port: 3000, title: "", nonce: 3 }],
      activeId: "pv9",
    });
  });

  it("creates a root tab when no tab is waiting", () => {
    expect(previewTabForPort([], 3000, () => "pv1")).toEqual({
      tabs: [{ id: "pv1", url: "localhost:3000", port: 3000, path: "/", nonce: 1 }],
      activeId: "pv1",
    });
  });
});

describe("preview tab transitions", () => {
  it("moves the active tab to its right neighbour, else its left", () => {
    expect(closedTab(TABS, "b", "b")).toEqual({ tabs: [TABS[0], TABS[2]], activeId: "c" });
    expect(closedTab(TABS, "c", "c")).toEqual({ tabs: [TABS[0], TABS[1]], activeId: "b" });
    expect(closedTab([tab("only")], "only", "only")).toEqual({ tabs: [], activeId: null });
  });

  it("keeps the active tab when another one closes", () => {
    expect(closedTab(TABS, "a", "c")).toEqual({ tabs: [TABS[0], TABS[1]], activeId: "a" });
  });

  it("ignores an unknown tab", () => {
    expect(closedTab(TABS, "a", "zz")).toBeNull();
  });

  it("closes every other tab and keeps this one active", () => {
    expect(closedOtherTabs(TABS, "b")).toEqual({ tabs: [TABS[1]], activeId: "b" });
  });

  it("closes the tabs to the right, keeping the active one when it survives", () => {
    expect(closedTabsToRight(TABS, "a", "b")).toEqual({ tabs: [TABS[0], TABS[1]], activeId: "a" });
    expect(closedTabsToRight(TABS, "c", "a")).toEqual({ tabs: [TABS[0]], activeId: "a" });
    expect(closedTabsToRight(TABS, "a", "zz")).toBeNull();
  });
});
