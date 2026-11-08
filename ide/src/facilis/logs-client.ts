// The VFS read layer for the Logs panel (D-119).
//
// SECURITY: the framework deliberately has NO log endpoint — not even dev-only — because
// a log endpoint would expose request paths, user ids, session hashes, client IPs and
// stack traces to anyone who can reach the dev server. Logs are FILES under
// <projectRoot>/.facilis/logs and this module reads them through the kernel VFS.
//
// The RPCs are the ones IdeController's VFS helpers wrap — `vv-readdir`, `vv-read-bytes`
// and `vv-stat` (see IdeController.readdir / readFileBytes / pathInfo) — so the panel sees
// exactly the project filesystem the Explorer and the editor see. The request function is
// injected rather than imported so this layer is testable in Node without a kernel.

import {
  logsDirFor,
  parseLogEntries,
  parseLogFileName,
  sortLogFiles,
  type LogEntry,
  type LogFileInfo,
} from "./logs-model";

/** A vv-reply body; unknown until the caller narrows the fields it needs. */
export interface LogsReply {
  [key: string]: unknown;
}

/** One kernel RPC round-trip (KernelBridge.request). */
export type LogsRequest = (type: string, payload: Record<string, unknown>) => Promise<LogsReply>;

export interface LogsVfs {
  request: LogsRequest;
}

/** Only the tail is read into the view; the file may be up to FACILIS_LOG_MAX_BYTES. */
export const LOG_TAIL_BYTES = 256 * 1024;

export interface LoadLogsOptions {
  /** File to read; defaults to the first file in the listing. */
  selectedName?: string | null;
  maxBytes?: number;
  maxLines?: number;
}

export interface LogsData {
  root: string;
  /** Absolute <projectRoot>/.facilis/logs. */
  dir: string;
  files: LogFileInfo[];
  selected: LogFileInfo | null;
  entries: LogEntry[];
  /** The file was longer than the read window. */
  truncated: boolean;
}

export type LogsListResult =
  { ok: true; files: LogFileInfo[]; missing: boolean } | { ok: false; error: string };

export type LogsTailResult =
  { ok: true; text: string; truncated: boolean } | { ok: false; error: string };

export type LogsLoadResult = { ok: true; data: LogsData } | { ok: false; error: string };

/**
 * List the JSONL files in the project's log directory, active files first and rotated
 * copies (".1", ".2" …) in order. A missing directory is the empty state, not a failure:
 * a project that has not served a request yet has simply written nothing.
 */
export async function listLogFiles(vfs: LogsVfs, root: string): Promise<LogsListResult> {
  const dir = logsDirFor(root);
  const dirStat = await vfs.request("vv-stat", { path: dir });
  if (dirStat.ok !== true) return { ok: false, error: errorOf(dirStat) };
  if (dirStat.exists !== true) return { ok: true, files: [], missing: true };
  const listing = await vfs.request("vv-readdir", { path: dir });
  if (listing.ok !== true) return { ok: false, error: errorOf(listing) };
  const entries = Array.isArray(listing.entries) ? listing.entries : [];
  const files: LogFileInfo[] = [];
  for (const entry of entries) {
    const name = entryName(entry);
    if (name === null) continue;
    const parsed = parseLogFileName(name);
    if (parsed === null) continue;
    const path = dir + "/" + name;
    const stat = await vfs.request("vv-stat", { path });
    files.push({
      name,
      path,
      kind: parsed.kind,
      rotation: parsed.rotation,
      size: statNumber(stat, "size"),
      mtimeMs: statNumber(stat, "mtimeMs"),
    });
  }
  return { ok: true, files: sortLogFiles(files), missing: false };
}

/**
 * Read the last `maxBytes` of a log file. The window is cut at a line boundary so the
 * view never starts with half an entry; the trailing line is kept, because a line the
 * writer is still flushing is real content and the parser marks it corrupt instead.
 */
export async function readLogTail(
  vfs: LogsVfs,
  path: string,
  maxBytes: number = LOG_TAIL_BYTES,
): Promise<LogsTailResult> {
  const reply = await vfs.request("vv-read-bytes", { path });
  if (reply.ok !== true) return { ok: false, error: errorOf(reply) };
  const bytes = reply.bytes instanceof Uint8Array ? reply.bytes : new Uint8Array();
  const truncated = bytes.length > maxBytes;
  const window = truncated ? bytes.subarray(bytes.length - maxBytes) : bytes;
  let text = new TextDecoder().decode(window);
  if (truncated) {
    const newline = text.indexOf("\n");
    text = newline === -1 ? "" : text.slice(newline + 1);
  }
  return { ok: true, text, truncated };
}

/**
 * Everything one panel refresh needs: the file listing, the selected file's parsed tail
 * and whether that tail was bounded. Ordering follows the contract (access, audit, error,
 * app; active file before its rotations).
 */
export async function loadLogs(
  vfs: LogsVfs,
  root: string,
  options: LoadLogsOptions = {},
): Promise<LogsLoadResult> {
  const listing = await listLogFiles(vfs, root);
  if (!listing.ok) return listing;
  const { files } = listing;
  const selected = files.find((file) => file.name === options.selectedName) ?? files[0] ?? null;
  let entries: LogEntry[] = [];
  let truncated = false;
  if (selected !== null) {
    const tail = await readLogTail(vfs, selected.path, options.maxBytes ?? LOG_TAIL_BYTES);
    if (!tail.ok) return tail;
    truncated = tail.truncated;
    entries = parseLogEntries(tail.text, {
      fallbackKind: selected.kind,
      maxLines: options.maxLines,
    });
  }
  return {
    ok: true,
    data: { root, dir: logsDirFor(root), files, selected, entries, truncated },
  };
}

function errorOf(reply: LogsReply): string {
  return typeof reply.error === "string" ? reply.error : "";
}

function entryName(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const name = (entry as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function statNumber(reply: LogsReply, key: "size" | "mtimeMs"): number | null {
  if (reply.ok !== true) return null;
  const value = reply[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
