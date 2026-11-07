// Synthetic editor tabs: ids that are not real file paths and must never be read or saved
// (D-087, D-088). They live outside the controller because the file-length ratchet pins it.
import type { TabKind } from "./controller";

// Diff tab: `vv-diff:<abs>`; the filename still renders because the target is the suffix.
const DIFF_PREFIX = "vv-diff:";
export const diffTabId = (abs: string): string => DIFF_PREFIX + abs;
export const isDiffTabId = (id: string | null): boolean => !!id && id.startsWith(DIFF_PREFIX);
export const diffTargetOf = (id: string): string => id.slice(DIFF_PREFIX.length);

// Commit-graph tab: one per repository, `vv-commit-graph:<root>` (D-088).
const COMMIT_GRAPH_PREFIX = "vv-commit-graph:";
export const commitGraphTabId = (root: string): string => COMMIT_GRAPH_PREFIX + root;
export const isCommitGraphTabId = (id: string | null): boolean =>
  !!id && id.startsWith(COMMIT_GRAPH_PREFIX);
export const commitGraphRootOf = (id: string): string => id.slice(COMMIT_GRAPH_PREFIX.length);

// Project-graph tab: one per editor (AST graph contract §7), no target.
const PROJECT_GRAPH_TAB = "vv-project-graph";
export const projectGraphTabId = (): string => PROJECT_GRAPH_TAB;
export const isProjectGraphTabId = (id: string | null): boolean => id === PROJECT_GRAPH_TAB;

// SQL query console tab: one per editor (D-097), no target.
const DATA_QUERY_TAB = "vv-data-query";
export const dataQueryTabId = (): string => DATA_QUERY_TAB;
export const isDataQueryTabId = (id: string | null): boolean => id === DATA_QUERY_TAB;

export interface SyntheticTabSnapshot {
  readonly openTabs: readonly string[];
  readonly tabKinds: Readonly<Record<string, TabKind>>;
}

/** The snapshot patch that opens (or focuses) one synthetic tab. */
function tabState(snapshot: SyntheticTabSnapshot, id: string, kind: TabKind) {
  return {
    openTabs: snapshot.openTabs.includes(id) ? [...snapshot.openTabs] : [...snapshot.openTabs, id],
    tabKinds: { ...snapshot.tabKinds, [id]: kind },
    activeTab: id,
    previewTab: null,
  };
}

/** The snapshot patch that opens (or focuses) a file's HEAD ↔ working-tree diff tab. */
export const diffTabState = (snapshot: SyntheticTabSnapshot, abs: string) =>
  tabState(snapshot, diffTabId(abs), "diff");

/** The snapshot patch that opens (or focuses) a repository's commit-graph tab. */
export const commitGraphTabState = (snapshot: SyntheticTabSnapshot, root: string) =>
  tabState(snapshot, commitGraphTabId(root), "commit-graph");

/** The snapshot patch that opens (or focuses) the project-graph tab. */
export const projectGraphTabState = (snapshot: SyntheticTabSnapshot) =>
  tabState(snapshot, projectGraphTabId(), "project-graph");

/** The snapshot patch that opens (or focuses) the SQL query console. */
export const dataQueryTabState = (snapshot: SyntheticTabSnapshot) =>
  tabState(snapshot, dataQueryTabId(), "data-query");
