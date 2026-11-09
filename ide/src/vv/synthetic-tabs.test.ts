// The synthetic-tab patches are the one place that decides what "open a graph/diff tab" means:
// they focus a single tab, register its kind (so the editor mounts the custom pane instead of a
// stale Monaco model) and never touch the snapshot they are handed. Landing on the graph when a
// workspace opens (D-127) rides on exactly this patch.
import { describe, expect, it } from "vitest";
import type { TabKind } from "./controller";
import {
  commitGraphTabId,
  commitGraphTabState,
  dataQueryTabId,
  dataQueryTabState,
  diffTabId,
  diffTabState,
  projectGraphTabId,
  projectGraphTabState,
} from "./synthetic-tabs";
import type { SyntheticTabSnapshot } from "./synthetic-tabs";

const ENTRY = "/home/user/projects/demo/src/app.tsx";
const ROOT = "/home/user/projects/demo";

function snapshot(
  openTabs: readonly string[] = [],
  tabKinds: Readonly<Record<string, TabKind>> = {},
): SyntheticTabSnapshot {
  return { openTabs, tabKinds };
}

describe("projectGraphTabState", () => {
  it("opens the graph tab and focuses it", () => {
    const patch = projectGraphTabState(snapshot([ENTRY], { [ENTRY]: "text" }));
    expect(patch.openTabs).toEqual([ENTRY, projectGraphTabId()]);
    expect(patch.activeTab).toBe(projectGraphTabId());
  });

  it("focuses the open graph tab again without duplicating it", () => {
    const state = snapshot([ENTRY, projectGraphTabId()], {
      [ENTRY]: "text",
      [projectGraphTabId()]: "project-graph",
    });
    const patch = projectGraphTabState(state);
    expect(patch.openTabs).toEqual([ENTRY, projectGraphTabId()]);
    expect(patch.activeTab).toBe(projectGraphTabId());
  });

  it("registers the project-graph kind the editor renders the panel from", () => {
    expect(projectGraphTabState(snapshot()).tabKinds[projectGraphTabId()]).toBe("project-graph");
  });

  it("leaves the preview slot empty", () => {
    // A synthetic tab is never a single-click preview, so no real file may sit in that slot.
    expect(projectGraphTabState(snapshot([ENTRY])).previewTab).toBeNull();
  });

  it("does not mutate the snapshot it is handed", () => {
    const openTabs = [ENTRY];
    const tabKinds: Record<string, TabKind> = { [ENTRY]: "text" };
    const state = snapshot(openTabs, tabKinds);
    const patch = projectGraphTabState(state);
    expect(state.openTabs).toEqual([ENTRY]);
    expect(state.tabKinds).toEqual({ [ENTRY]: "text" });
    expect(patch.openTabs).not.toBe(openTabs);
    expect(patch.tabKinds).not.toBe(tabKinds);
  });
});

describe("diff / commit-graph / data-query tab patches", () => {
  it("focuses the diff tab of the target file", () => {
    const patch = diffTabState(snapshot([ENTRY]), ENTRY);
    expect(patch.activeTab).toBe(diffTabId(ENTRY));
    expect(patch.openTabs).toEqual([ENTRY, diffTabId(ENTRY)]);
    expect(patch.tabKinds[diffTabId(ENTRY)]).toBe("diff");
  });

  it("focuses the commit-graph tab of the repository", () => {
    const patch = commitGraphTabState(snapshot([ENTRY]), ROOT);
    expect(patch.activeTab).toBe(commitGraphTabId(ROOT));
    expect(patch.tabKinds[commitGraphTabId(ROOT)]).toBe("commit-graph");
  });

  it("focuses the data-query console", () => {
    const patch = dataQueryTabState(snapshot([ENTRY]));
    expect(patch.activeTab).toBe(dataQueryTabId());
    expect(patch.tabKinds[dataQueryTabId()]).toBe("data-query");
  });

  it("focuses an already-open synthetic tab instead of adding a second one", () => {
    const cases = [
      { patch: projectGraphTabState(snapshot([projectGraphTabId()])), id: projectGraphTabId() },
      { patch: diffTabState(snapshot([diffTabId(ENTRY)]), ENTRY), id: diffTabId(ENTRY) },
      {
        patch: commitGraphTabState(snapshot([commitGraphTabId(ROOT)]), ROOT),
        id: commitGraphTabId(ROOT),
      },
      { patch: dataQueryTabState(snapshot([dataQueryTabId()])), id: dataQueryTabId() },
    ];
    for (const { patch, id } of cases) {
      expect(patch.openTabs).toEqual([id]);
      expect(patch.activeTab).toBe(id);
      expect(patch.previewTab).toBeNull();
    }
  });
});
