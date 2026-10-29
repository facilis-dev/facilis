// The recent-projects registry (Home's "Recent" list) is per ORIGIN: every Studio tab
// reads the same localStorage key. Each tab used to write back its own in-memory list, so
// a tab that booted before another one created a project silently dropped that project on
// its next write. Measured with two tabs: tab A created alpha, tab B (opened first) then
// created beta, and the stored list no longer named alpha — Home showed one project while
// alpha's files were still in the VFS and OPFS, so trying to recreate it failed with
// "That directory is not empty."
//
// Writes are therefore read-merge-write against the CURRENT storage (upserts by rootPath,
// explicit removals), and the tab keeps its snapshot live through the "storage" event.

// A project's identity is its rootPath, and its label is that path's last segment
// (project-name.ts). There is deliberately no stored display name: the old field could
// disagree with the directory, so two projects in one tab looked identical.
export interface ProjectMeta {
  rootPath: string;
  template: string | null;
  createdAt: number;
  lastModified: number;
}

export const PROJECTS_KEY = "vv-workspace-projects";

type RegistryStorage = Pick<Storage, "getItem" | "setItem">;

function sortByRecent(list: ProjectMeta[]): ProjectMeta[] {
  return [...list].sort((a, b) => b.lastModified - a.lastModified);
}

// localStorage is shared with other tabs and with older builds, so an entry missing a
// field must not poison the whole list: keep the well-formed ones, normalise the rest.
function normalizeEntry(value: unknown): ProjectMeta | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  // Legacy entries also carried `name`; it is ignored rather than trusted.
  if (typeof entry.rootPath !== "string") return null;
  const lastModified = typeof entry.lastModified === "number" ? entry.lastModified : Date.now();
  return {
    rootPath: entry.rootPath,
    template: typeof entry.template === "string" ? entry.template : null,
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : lastModified,
    lastModified,
  };
}

export function readRegistry(storage: RegistryStorage): ProjectMeta[] {
  try {
    const raw = storage.getItem(PROJECTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.map(normalizeEntry).filter((entry): entry is ProjectMeta => !!entry);
    return sortByRecent(entries);
  } catch {
    return [];
  }
}

/**
 * Read-merge-write: keep every entry another tab stored, apply this tab's changes, and
 * prune only what it explicitly removed. Returns the merged list for the caller's
 * snapshot.
 */
export function writeRegistry(
  storage: RegistryStorage,
  changes: { upsert?: ProjectMeta[]; remove?: string[] },
): ProjectMeta[] {
  const byPath = new Map(readRegistry(storage).map((entry) => [entry.rootPath, entry]));
  for (const entry of changes.upsert ?? []) {
    const stored = byPath.get(entry.rootPath);
    // Two tabs touching the same project: the newer timestamp is the truer one.
    if (!stored || stored.lastModified <= entry.lastModified) byPath.set(entry.rootPath, entry);
  }
  for (const rootPath of changes.remove ?? []) byPath.delete(rootPath);
  const merged = sortByRecent([...byPath.values()]);
  try {
    storage.setItem(PROJECTS_KEY, JSON.stringify(merged));
  } catch {
    /* storage full / disabled — the in-memory list still works this session */
  }
  return merged;
}
