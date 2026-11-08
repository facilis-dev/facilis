// The Logs panel's pure model (D-119): one JSONL line in, one row out.
//
// The framework writes access/audit/error/app entries as JSON Lines to
// <projectRoot>/.facilis/logs ({name}.jsonl plus rotated .1.jsonl, .2.jsonl …). Nothing
// here touches the network or the VFS — `logs-client.ts` owns the kernel read and maps
// the parsed rows onto a file listing. Keeping this half pure is what lets the parser,
// the rotation ordering and the filters be tested without a browser or a kernel.
//
// Corrupt and half-written lines are KEPT as rows rather than dropped: a partially
// flushed line is exactly what someone inspecting a file during a request burst should
// see, and silently hiding it makes the panel look frozen.

export const LOG_KINDS = ["access", "audit", "error", "app"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** One rendered row: one line of the selected file, parsed as far as it could be. */
export interface LogEntry {
  /** `unknown` when the line is unparseable or carries no valid `kind`. */
  kind: LogKind | "unknown";
  level: LogLevel | "unknown";
  /** Epoch milliseconds, or null when `ts` is missing/unparseable. */
  ts: number | null;
  requestId: string | null;
  /** One-line summary built from the entry's own fields (never translated). */
  summary: string;
  /** The parsed object for the details pane; null for an unparseable line. */
  raw: Record<string, unknown> | null;
  /** 1-based line number within the read window (the tail, not the whole file). */
  line: number;
  corrupt: boolean;
}

/** One log file in the directory, including its rotated copies. */
export interface LogFileInfo {
  /** File name as it exists on disk, e.g. `audit.jsonl` or `audit.2.jsonl`. */
  name: string;
  /** Absolute VFS path. */
  path: string;
  kind: LogKind;
  /** 0 is the active file; 1+ are rotations (1 = newest rotation). */
  rotation: number;
  /** Bytes from the VFS `stat`, or null when it could not be read. */
  size: number | null;
  mtimeMs: number | null;
}

/** A parsed file name; the client uses `kind`/`rotation` to sort the listing. */
export interface LogFileName {
  kind: LogKind;
  rotation: number;
}

export interface LogFilter {
  kind?: LogKind | "all";
  level?: LogLevel | "all";
  /** Case-insensitive substring over the summary and the raw JSON. */
  text?: string;
}

export interface ParseLogOptions {
  /** Keep only the last N lines (the read window is already byte-bounded). */
  maxLines?: number;
  /** Kind to assume when a line has none — the file's own kind. */
  fallbackKind?: LogKind;
}

/** Enough rows to scroll through without ever rendering an unbounded tail. */
export const DEFAULT_MAX_LINES = 2000;

const LOG_FILE_PATTERN = /^(access|audit|error|app)(?:\.(\d{1,3}))?\.jsonl$/;
const KIND_ORDER = new Map<LogKind, number>(LOG_KINDS.map((kind, index) => [kind, index]));
const KIND_SET = new Set<string>(LOG_KINDS);
const LEVEL_SET = new Set<string>(LOG_LEVELS);

export function isLogKind(value: unknown): value is LogKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && LEVEL_SET.has(value);
}

/**
 * Parse a log file name. Rotation shifts the active file to `.1`, which becomes `.2`
 * on the next shift, so the rotation number alone says which copy is newer.
 */
export function parseLogFileName(name: string): LogFileName | null {
  const match = LOG_FILE_PATTERN.exec(name);
  if (match === null) return null;
  return {
    kind: match[1] as LogKind,
    rotation: match[2] === undefined ? 0 : Number(match[2]),
  };
}

/** The project's log directory (the absolute project root is required). */
export function logsDirFor(root: string): string {
  return root.replace(/\/+$/, "") + "/.facilis/logs";
}

/** Active file first, then its rotations (newest to oldest), grouped by kind. */
export function sortLogFiles(files: readonly LogFileInfo[]): LogFileInfo[] {
  return [...files].sort((a, b) => {
    const byKind = (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0);
    if (byKind !== 0) return byKind;
    if (a.rotation !== b.rotation) return a.rotation - b.rotation;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Parse one line. Returns null for a blank line, a row for everything else — never
 * throws, because a corrupt line must not take the whole view down with it.
 */
export function parseLogLine(
  line: string,
  lineNo: number,
  fallbackKind?: LogKind,
): LogEntry | null {
  const text = line.replace(/\r$/, "");
  if (text.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return corruptEntry(text, lineNo);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return corruptEntry(text, lineNo);
  }
  const raw = value as Record<string, unknown>;
  const kind = isLogKind(raw.kind) ? raw.kind : (fallbackKind ?? "unknown");
  return {
    kind,
    level: isLogLevel(raw.level) ? raw.level : "unknown",
    ts: parseTs(raw.ts),
    requestId: typeof raw.requestId === "string" ? raw.requestId : null,
    summary: summarize(kind, raw),
    raw,
    line: lineNo,
    corrupt: false,
  };
}

/** Parse a whole tail window, keeping at most `maxLines` (the newest ones). */
export function parseLogEntries(text: string, options: ParseLogOptions = {}): LogEntry[] {
  const lines = text.split("\n");
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const first = Math.max(0, lines.length - maxLines);
  const entries: LogEntry[] = [];
  for (let index = first; index < lines.length; index += 1) {
    const entry = parseLogLine(lines[index], index + 1, options.fallbackKind);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

/** Rows render newest first; files are append-only, so reversing is enough. */
export function newestFirst(entries: readonly LogEntry[]): LogEntry[] {
  return [...entries].reverse();
}

export function filterLogEntries(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  const kind = filter.kind ?? "all";
  const level = filter.level ?? "all";
  const needle = (filter.text ?? "").trim().toLowerCase();
  return entries.filter((entry) => {
    if (kind !== "all" && entry.kind !== kind) return false;
    if (level !== "all" && entry.level !== level) return false;
    if (needle === "") return true;
    const haystack = entry.summary + " " + (entry.raw === null ? "" : JSON.stringify(entry.raw));
    return haystack.toLowerCase().includes(needle);
  });
}

/** `HH:MM:SS.mmm` in UTC: entries are written with an ISO-8601 UTC `ts`. */
export function formatLogTime(ts: number | null): string {
  if (ts === null || !Number.isFinite(ts)) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(11, 23);
}

/** `N ms` — "ms" is the same measurement symbol in both catalogues. */
export function formatLogDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return Math.max(0, Math.round(ms)) + " ms";
}

/** `N B` / `N.N KB` / `N.N MB` — byte units are symbols, not words. */
export function formatLogSize(size: number | null | undefined): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

function corruptEntry(text: string, lineNo: number): LogEntry {
  return {
    kind: "unknown",
    level: "unknown",
    ts: null,
    requestId: null,
    summary: clip(text.trim()),
    raw: null,
    line: lineNo,
    corrupt: true,
  };
}

function parseTs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function summarize(kind: LogKind | "unknown", raw: Record<string, unknown>): string {
  switch (kind) {
    case "access": {
      const head = joinParts([asText(raw.method), asText(raw.path), asText(raw.status)]);
      const duration = formatLogDuration(asNumber(raw.durationMs));
      return clip(head === "" ? fallbackSummary(raw) : joinParts([head, duration], " · "));
    }
    case "audit":
      return clip(
        joinParts(
          [asText(raw.event) ?? asText(raw.operation), asText(raw.actor), asText(raw.outcome)],
          " · ",
        ) || fallbackSummary(raw),
      );
    case "error":
      return clip(joinParts([asText(raw.code), asText(raw.message)], ": ") || fallbackSummary(raw));
    case "app":
      return clip(asText(raw.message) ?? fallbackSummary(raw));
    default:
      return clip(fallbackSummary(raw));
  }
}

/** Last resort: the entry's own JSON, so a row never renders empty. */
function fallbackSummary(raw: Record<string, unknown>): string {
  try {
    return clip(JSON.stringify(raw));
  } catch {
    return "";
  }
}

function joinParts(parts: readonly (string | null)[], separator = " "): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(separator);
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clip(text: string, max = 200): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
