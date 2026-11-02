// Synthetic editor tabs: ids that are not real file paths and must never be read or saved
// (D-087, D-088). They live outside the controller because the file-length ratchet pins it.
import type { TabKind } from "./controller";

// Diff tab: `vv-diff:<abs>`; the filename still renders because the target is the suffix.
const DIFF_PREFIX = "vv-diff:";
export const diffTabId = (abs: string): string => DIFF_PREFIX + abs;
export const isDiffTabId = (id: string | null): boolean => !!id && id.startsWith(DIFF_PREFIX);
export const diffTargetOf = (id: string): string => id.slice(DIFF_PREFIX.length);

// API Flow tab: one per editor, no target (D-087).
const API_FLOW_TAB = "vv-api-flow";
export const apiFlowTabId = (): string => API_FLOW_TAB;
export const isApiFlowTabId = (id: string | null): boolean => id === API_FLOW_TAB;

// Commit-graph tab: one per repository, `vv-commit-graph:<root>` (D-088).
const COMMIT_GRAPH_PREFIX = "vv-commit-graph:";
export const commitGraphTabId = (root: string): string => COMMIT_GRAPH_PREFIX + root;
export const isCommitGraphTabId = (id: string | null): boolean =>
  !!id && id.startsWith(COMMIT_GRAPH_PREFIX);
export const commitGraphRootOf = (id: string): string => id.slice(COMMIT_GRAPH_PREFIX.length);

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

/** The snapshot patch that opens (or focuses) the API Flow tab. */
export const apiFlowTabState = (snapshot: SyntheticTabSnapshot) =>
  tabState(snapshot, apiFlowTabId(), "api-flow");

/** The snapshot patch that opens (or focuses) a file's HEAD ↔ working-tree diff tab. */
export const diffTabState = (snapshot: SyntheticTabSnapshot, abs: string) =>
  tabState(snapshot, diffTabId(abs), "diff");

/** The snapshot patch that opens (or focuses) a repository's commit-graph tab. */
export const commitGraphTabState = (snapshot: SyntheticTabSnapshot, root: string) =>
  tabState(snapshot, commitGraphTabId(root), "commit-graph");
