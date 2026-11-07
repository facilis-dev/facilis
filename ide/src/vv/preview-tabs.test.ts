import { describe, expect, it } from "vitest";
import type { PreviewTab } from "./preview-session";
import { closedOtherTabs, closedTab, closedTabsToRight } from "./preview-tabs";

function tab(id: string): PreviewTab {
  return { id, url: "localhost:5173", path: "/", port: 5173, nonce: 1 };
}

const TABS = [tab("a"), tab("b"), tab("c")];

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
