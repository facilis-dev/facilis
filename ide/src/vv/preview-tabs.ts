// Tab-list transitions for the preview panel (D-019). Pure, so the session class stays within
// the file-length limit and the close/reorder logic is unit-tested without a DOM.

import type { PreviewTab } from "./preview-session";

export interface PreviewTabsUpdate {
  tabs: PreviewTab[];
  activeId: string | null;
}

/** Close one tab; the active one moves to its right neighbour, else its left. */
export function closedTab(
  tabs: readonly PreviewTab[],
  activeId: string | null,
  id: string,
): PreviewTabsUpdate | null {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return null;
  const remaining = tabs.filter((tab) => tab.id !== id);
  if (activeId !== id) return { tabs: remaining, activeId };
  return { tabs: remaining, activeId: (remaining[index] ?? remaining[index - 1])?.id ?? null };
}

/** Close every tab but this one. */
export function closedOtherTabs(tabs: readonly PreviewTab[], id: string): PreviewTabsUpdate {
  return { tabs: tabs.filter((tab) => tab.id === id), activeId: id };
}

/**
 * The tab a dev server binds. A tab already waiting for a server (port null, e.g. PreviewPanel's
 * empty state or the graph's "Open in preview" before a run) keeps its path and becomes that
 * server's tab; otherwise a new root tab is created. This is what makes the path the user asked
 * for the first document the preview paints.
 */
export function previewTabForPort(
  tabs: readonly PreviewTab[],
  port: number,
  nextId: () => string,
): PreviewTabsUpdate {
  const pending = tabs.find((tab) => tab.port === null);
  if (pending !== undefined) {
    return {
      tabs: tabs.map((tab) =>
        tab.id === pending.id
          ? { ...tab, port, url: `localhost:${port}`, title: "", nonce: tab.nonce + 1 }
          : tab,
      ),
      activeId: pending.id,
    };
  }
  const id = nextId();
  return {
    tabs: [...tabs, { id, url: `localhost:${port}`, port, path: "/", nonce: 1 }],
    activeId: id,
  };
}

/** Close every tab to the right, keeping this one active if the old active tab survives. */
export function closedTabsToRight(
  tabs: readonly PreviewTab[],
  activeId: string | null,
  id: string,
): PreviewTabsUpdate | null {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return null;
  const kept = tabs.slice(0, index + 1);
  const active = kept.some((tab) => tab.id === activeId) ? activeId : id;
  return { tabs: kept, activeId: active };
}
