// Synthetic editor tabs: ids that are not real file paths and must never be read or saved
// (D-087). They live outside the controller because the file-length ratchet pins it.
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

export interface SyntheticTabSnapshot {
  readonly openTabs: readonly string[];
  readonly tabKinds: Readonly<Record<string, TabKind>>;
}

/** The snapshot patch that opens (or focuses) the API Flow tab. */
export function apiFlowTabState(snapshot: SyntheticTabSnapshot) {
  const id = apiFlowTabId();
  return {
    openTabs: snapshot.openTabs.includes(id) ? [...snapshot.openTabs] : [...snapshot.openTabs, id],
    tabKinds: { ...snapshot.tabKinds, [id]: "api-flow" as const },
    activeTab: id,
    previewTab: null,
  };
}
