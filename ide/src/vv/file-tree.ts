// Reading an OS folder or a drag-drop into a flat, path-keyed file tree, the
// shape import/export/share pass around. Split out of controller.ts, which only
// wraps the results into a project (the ratchet keeps it shrinking, D-019).

// A flat, path-keyed file tree used by import/export/share.
export type FileTree = { path: string; bytes: Uint8Array }[];

// The result of reading an OS folder/drop into a project tree: the files plus a
// flag noting whether a (skipped) node_modules was present, so import can say so.
export type ImportTree = { name: string; files: FileTree; excludedNodeModules: boolean };

// Never import these into a project — at ANY depth (monorepos have many nested
// node_modules), since they're regenerated, huge, or VCS metadata.
function skipImportPath(path: string): boolean {
  return path.split("/").some((seg) => seg === "node_modules" || seg === ".git");
}
function hasNodeModules(path: string): boolean {
  return path.split("/").some((seg) => seg === "node_modules");
}

// Read a <input type="file" webkitdirectory> selection into a flat file tree.
// webkitRelativePath is "<pickedDir>/a/b.js"; strip the leading picked-dir
// segment so the project root holds a/b.js directly. Returns a suggested name.
export async function treeFromFileList(list: FileList): Promise<ImportTree> {
  let top = "";
  let excludedNodeModules = false;
  const files: FileTree = [];
  for (const file of Array.from(list)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = rel.split("/").filter(Boolean);
    if (parts.length > 1 && !top) top = parts[0];
    const path = parts.length > 1 && parts[0] === top ? parts.slice(1).join("/") : rel;
    if (!path || skipImportPath(path)) {
      if (path && hasNodeModules(path)) excludedNodeModules = true;
      continue;
    }
    files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return { name: top || "imported-project", files, excludedNodeModules };
}

// Read an OS drop (DataTransfer entries) into a flat file tree. A single dropped
// folder becomes the project; loose files / multiple items land at the root.
export async function treeFromDrop(entries: FileSystemEntry[]): Promise<ImportTree> {
  const files: FileTree = [];
  let excludedNodeModules = false;
  const single = entries.length === 1 && entries[0].isDirectory ? entries[0] : null;
  const roots = single ? await readDirEntries(single as FileSystemDirectoryEntry) : entries;
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix ? prefix + "/" + entry.name : entry.name;
    if (skipImportPath(path)) {
      if (hasNodeModules(path)) excludedNodeModules = true;
      return;
    }
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej),
      );
      files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    } else if (entry.isDirectory) {
      const children = await readDirEntries(entry as FileSystemDirectoryEntry);
      for (const c of children) await walk(c, path);
    }
  };
  for (const r of roots) await walk(r, "");
  return { name: single ? single.name : "imported-project", files, excludedNodeModules };
}

// Extract OS FileSystemEntry objects from a drop's DataTransfer. MUST be called
// SYNCHRONOUSLY inside the drop handler — the DataTransferItemList (and thus
// webkitGetAsEntry) is invalidated once the handler yields to an await.
export function entriesFromDataTransfer(dt: DataTransfer): FileSystemEntry[] {
  const out: FileSystemEntry[] = [];
  const items = dt.items;
  if (!items) return out;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== "file") continue;
    const entry = (
      it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }
    ).webkitGetAsEntry?.();
    if (entry) out.push(entry);
  }
  return out;
}

// Read every child of a directory entry (createReader is paginated — keep
// reading until a batch comes back empty).
export function readDirEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const readBatch = () =>
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    readBatch();
  });
}
