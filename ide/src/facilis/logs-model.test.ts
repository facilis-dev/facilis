import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LINES,
  filterLogEntries,
  formatLogDuration,
  formatLogSize,
  formatLogTime,
  isLogKind,
  logsDirFor,
  newestFirst,
  parseLogEntries,
  parseLogFileName,
  parseLogLine,
  sortLogFiles,
  type LogEntry,
  type LogFileInfo,
} from "./logs-model";

function file(name: string): LogFileInfo {
  const parsed = parseLogFileName(name);
  return {
    name,
    path: "/p/.facilis/logs/" + name,
    kind: parsed?.kind ?? "app",
    rotation: parsed?.rotation ?? 0,
    size: 10,
    mtimeMs: 1,
  };
}

const ACCESS = JSON.stringify({
  kind: "access",
  ts: "2026-11-08T10:00:00.000Z",
  level: "info",
  requestId: "req-123",
  method: "GET",
  path: "/api/todos",
  status: 200,
  durationMs: 12,
  userId: "user-1",
});

describe("parseLogFileName", () => {
  it("recognizes the active file and its rotations", () => {
    expect(parseLogFileName("access.jsonl")).toEqual({ kind: "access", rotation: 0 });
    expect(parseLogFileName("audit.1.jsonl")).toEqual({ kind: "audit", rotation: 1 });
    expect(parseLogFileName("error.12.jsonl")).toEqual({ kind: "error", rotation: 12 });
    expect(parseLogFileName("app.2.jsonl")).toEqual({ kind: "app", rotation: 2 });
  });

  it("rejects names outside the four-stream contract", () => {
    expect(parseLogFileName("notes.jsonl")).toBeNull();
    expect(parseLogFileName("access.log")).toBeNull();
    expect(parseLogFileName("access.1.json")).toBeNull();
    expect(parseLogFileName(".jsonl")).toBeNull();
  });
});

describe("parseLogLine", () => {
  it("parses a valid access line into a row", () => {
    const entry = parseLogLine(ACCESS, 3);
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      kind: "access",
      level: "info",
      requestId: "req-123",
      ts: Date.parse("2026-11-08T10:00:00.000Z"),
      line: 3,
      corrupt: false,
    });
    expect(entry?.summary).toContain("GET /api/todos 200");
    expect(entry?.summary).toContain("12 ms");
    expect(entry?.raw?.status).toBe(200);
  });

  it("returns null for blank lines only", () => {
    expect(parseLogLine("", 1)).toBeNull();
    expect(parseLogLine("   ", 2)).toBeNull();
    expect(parseLogLine("\r", 3)).toBeNull();
  });

  it("keeps a corrupt line as an unparseable row instead of throwing", () => {
    const entry = parseLogLine('{"kind":"app","message":"half wri', 4);
    expect(entry).toMatchObject({ kind: "unknown", level: "unknown", corrupt: true });
    expect(entry?.raw).toBeNull();
    expect(entry?.summary).toBe('{"kind":"app","message":"half wri');
  });

  it("treats valid JSON that is not an object as corrupt", () => {
    expect(parseLogLine("[1,2]", 1)?.corrupt).toBe(true);
    expect(parseLogLine('"text"', 1)?.corrupt).toBe(true);
    expect(parseLogLine("null", 1)?.corrupt).toBe(true);
  });

  it("falls back to the file's kind when the entry has none", () => {
    const entry = parseLogLine(
      '{"level":"info","event":"auth:sso:login","actor":"anon"}',
      1,
      "audit",
    );
    expect(entry?.kind).toBe("audit");
    expect(entry?.level).toBe("info");
  });

  it("parses numeric and ISO timestamps, and leaves bad ones null", () => {
    expect(parseLogLine('{"kind":"app","ts":1700000000000,"level":"info"}', 1)?.ts).toBe(
      1700000000000,
    );
    expect(parseLogLine('{"kind":"app","ts":"2026-11-08T10:00:00.000Z"}', 1)?.ts).toBe(
      Date.parse("2026-11-08T10:00:00.000Z"),
    );
    expect(parseLogLine('{"kind":"app","ts":"not-a-date"}', 1)?.ts).toBeNull();
    expect(parseLogLine('{"kind":"app"}', 1)?.ts).toBeNull();
  });

  it("summarizes each stream from its own fields", () => {
    const audit = parseLogLine(
      '{"kind":"audit","ts":"2026-11-08T10:00:00Z","level":"info","event":"sudo:started","actor":"user-1","outcome":"succeeded"}',
      1,
    );
    expect(audit?.summary).toBe("sudo:started · user-1 · succeeded");
    const error = parseLogLine(
      '{"kind":"error","ts":"2026-11-08T10:00:00Z","level":"error","code":"internal_error","message":"boom"}',
      1,
    );
    expect(error?.summary).toBe("internal_error: boom");
    const app = parseLogLine('{"kind":"app","level":"warn","message":"slow query"}', 1);
    expect(app?.summary).toBe("slow query");
  });
});

describe("parseLogEntries", () => {
  it("parses the window in file order, skipping blank lines", () => {
    const text = [ACCESS, "", '{"kind":"app","level":"info","message":"second"}', ""].join("\n");
    const entries = parseLogEntries(text);
    expect(entries.map((entry) => entry.line)).toEqual([1, 3]);
  });

  it("keeps only the newest lines when the window is capped", () => {
    const text = Array.from(
      { length: 10 },
      (_, index) => '{"kind":"app","message":"m' + index + '"}',
    ).join("\n");
    const entries = parseLogEntries(text, { maxLines: 3 });
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.line)).toEqual([8, 9, 10]);
    expect(entries[2]?.summary).toBe("m9");
  });

  it("caps at the default line count", () => {
    const text = "\n".repeat(DEFAULT_MAX_LINES + 5) + '{"kind":"app","message":"last"}';
    expect(parseLogEntries(text)).toHaveLength(1);
  });
});

describe("filters", () => {
  const entries: LogEntry[] = [
    entry({
      kind: "access",
      level: "info",
      summary: "GET /api/todos 200",
      raw: { path: "/api/todos" },
    }),
    entry({
      kind: "access",
      level: "error",
      summary: "POST /api/todos 500",
      raw: { path: "/api/todos" },
    }),
    entry({
      kind: "audit",
      level: "info",
      summary: "auth:sso:login · user-1",
      raw: { actor: "user-1" },
    }),
    entry({ kind: "unknown", level: "unknown", summary: "corrupt", raw: null, corrupt: true }),
  ];

  it("filters by kind, level and text together", () => {
    expect(filterLogEntries(entries, { kind: "access" })).toHaveLength(2);
    expect(filterLogEntries(entries, { level: "error" })).toHaveLength(1);
    expect(filterLogEntries(entries, { kind: "access", level: "info" })).toHaveLength(1);
    expect(filterLogEntries(entries, { text: "USER-1" })).toHaveLength(1);
    expect(filterLogEntries(entries, { text: "/api/todos", kind: "audit" })).toHaveLength(0);
    expect(filterLogEntries(entries, {})).toHaveLength(4);
  });

  it("matches text against the raw JSON too", () => {
    expect(filterLogEntries(entries, { text: "corrupt" })).toHaveLength(1);
  });

  it("renders newest first", () => {
    expect(newestFirst(entries).map((row) => row.summary)).toEqual([
      "corrupt",
      "auth:sso:login · user-1",
      "POST /api/todos 500",
      "GET /api/todos 200",
    ]);
    expect(entries[0]?.summary).toBe("GET /api/todos 200");
  });
});

describe("rotation ordering", () => {
  it("groups by kind and lists the active file before its rotations", () => {
    const files = [
      file("app.jsonl"),
      file("audit.2.jsonl"),
      file("access.1.jsonl"),
      file("access.jsonl"),
      file("error.jsonl"),
      file("access.2.jsonl"),
      file("audit.jsonl"),
      file("notes.jsonl"),
    ];
    const sorted = sortLogFiles(files.filter((f) => parseLogFileName(f.name) !== null));
    expect(sorted.map((f) => f.name)).toEqual([
      "access.jsonl",
      "access.1.jsonl",
      "access.2.jsonl",
      "audit.jsonl",
      "audit.2.jsonl",
      "error.jsonl",
      "app.jsonl",
    ]);
  });
});

describe("formatting", () => {
  it("formats timestamps as UTC time with milliseconds", () => {
    expect(formatLogTime(Date.parse("2026-11-08T10:00:00.123Z"))).toBe("10:00:00.123");
    expect(formatLogTime(null)).toBe("");
    expect(formatLogTime(Number.NaN)).toBe("");
  });

  it("formats durations and byte sizes", () => {
    expect(formatLogDuration(12)).toBe("12 ms");
    expect(formatLogDuration(12.6)).toBe("13 ms");
    expect(formatLogDuration(null)).toBe("");
    expect(formatLogSize(512)).toBe("512 B");
    expect(formatLogSize(1536)).toBe("1.5 KB");
    expect(formatLogSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatLogSize(null)).toBe("");
  });

  it("builds the log directory from the project root", () => {
    expect(logsDirFor("/p")).toBe("/p/.facilis/logs");
    expect(logsDirFor("/p/")).toBe("/p/.facilis/logs");
    expect(logsDirFor("/")).toBe("/.facilis/logs");
  });

  it("recognizes log kinds", () => {
    expect(isLogKind("audit")).toBe(true);
    expect(isLogKind("system")).toBe(false);
  });
});

function entry(overrides: Partial<LogEntry>): LogEntry {
  return {
    kind: "app",
    level: "info",
    ts: null,
    requestId: null,
    summary: "",
    raw: {},
    line: 1,
    corrupt: false,
    ...overrides,
  };
}
