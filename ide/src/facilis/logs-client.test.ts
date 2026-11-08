import { describe, expect, it } from "vitest";
import {
  LOG_TAIL_BYTES,
  listLogFiles,
  loadLogs,
  readLogTail,
  type LogsReply,
  type LogsVfs,
} from "./logs-client";

const LOGS_DIR = "/p/.facilis/logs";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

interface FakeKernel {
  calls: string[];
  vfs: LogsVfs;
}

/** A minimal kernel: files and directories over the same vv-* replies the real VFS sends. */
function fakeKernel(
  files: Record<string, string>,
  options: { dirs?: string[]; failStat?: string[] } = {},
): FakeKernel {
  const dirs = new Set(options.dirs ?? []);
  const failStat = new Set(options.failStat ?? []);
  const calls: string[] = [];
  for (const path of Object.keys(files)) {
    const slash = path.lastIndexOf("/");
    if (slash > 0) dirs.add(path.slice(0, slash));
  }
  const namesIn = (dir: string): string[] => {
    const prefix = dir + "/";
    const names = new Set<string>();
    for (const path of [...Object.keys(files), ...dirs]) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest !== "" && !rest.includes("/")) names.add(rest);
    }
    return [...names].sort();
  };
  const vfs: LogsVfs = {
    request: async (type: string, payload: Record<string, unknown>): Promise<LogsReply> => {
      const path = typeof payload.path === "string" ? payload.path : "";
      calls.push(type + " " + path);
      if (type === "vv-stat") {
        if (failStat.has(path)) return { ok: false, error: "EIO" };
        if (path in files) {
          const bytes = encode(files[path]);
          return {
            ok: true,
            exists: true,
            isDir: false,
            size: bytes.length,
            mtimeMs: 1700000000000,
          };
        }
        if (dirs.has(path)) return { ok: true, exists: true, isDir: true };
        return { ok: true, exists: false, isDir: false };
      }
      if (type === "vv-readdir") {
        if (!dirs.has(path)) return { ok: false, error: "ENOENT: " + path };
        return {
          ok: true,
          entries: namesIn(path).map((name) => ({
            name,
            dir: dirs.has(path + "/" + name),
          })),
        };
      }
      if (type === "vv-read-bytes") {
        const text = files[path];
        if (text === undefined) return { ok: false, error: "ENOENT: " + path };
        return { ok: true, bytes: encode(text) };
      }
      return { ok: false, error: "unexpected " + type };
    },
  };
  return { calls, vfs };
}

describe("listLogFiles", () => {
  it("is the empty state when the log directory does not exist yet", async () => {
    const { vfs } = fakeKernel({});
    const result = await listLogFiles(vfs, "/p");
    expect(result).toEqual({ ok: true, files: [], missing: true });
  });

  it("lists the active files and their rotations with sizes", async () => {
    const { vfs } = fakeKernel({
      [LOGS_DIR + "/access.jsonl"]: "a\n",
      [LOGS_DIR + "/access.1.jsonl"]: "aa\n",
      [LOGS_DIR + "/audit.jsonl"]: "aaa\n",
      [LOGS_DIR + "/notes.txt"]: "not a log",
    });
    const result = await listLogFiles(vfs, "/p");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missing).toBe(false);
    expect(result.files.map((file) => file.name)).toEqual([
      "access.jsonl",
      "access.1.jsonl",
      "audit.jsonl",
    ]);
    expect(result.files[0]).toMatchObject({ kind: "access", rotation: 0, size: 2 });
    expect(result.files[1]).toMatchObject({ kind: "access", rotation: 1, size: 3 });
    expect(result.files[2]).toMatchObject({ kind: "audit", rotation: 0, mtimeMs: 1700000000000 });
  });

  it("reports a failed log-directory stat as an error", async () => {
    const { vfs } = fakeKernel({}, { failStat: [LOGS_DIR] });
    expect(await listLogFiles(vfs, "/p")).toEqual({ ok: false, error: "EIO" });
  });

  it("keeps a file whose stat failed (unknown size) instead of dropping it", async () => {
    const access = LOGS_DIR + "/access.jsonl";
    const { vfs } = fakeKernel({ [access]: "a\n" }, { failStat: [access] });
    const result = await listLogFiles(vfs, "/p");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.size).toBeNull();
  });

  it("reports a readdir failure as an error", async () => {
    const { vfs } = fakeKernel({ [LOGS_DIR + "/access.jsonl"]: "a\n" });
    // The directory exists but the listing fails: make readdir answer for a directory
    // the fake does not know by asking with a trailing slash.
    const failing: LogsVfs = {
      request: async (type) =>
        type === "vv-stat"
          ? { ok: true, exists: true, isDir: true }
          : { ok: false, error: "EPERM" },
    };
    expect(await listLogFiles(vfs, "/p")).toMatchObject({ ok: true });
    expect(await listLogFiles(failing, "/p")).toEqual({ ok: false, error: "EPERM" });
  });
});

describe("readLogTail", () => {
  it("returns the whole file when it fits", async () => {
    const path = LOGS_DIR + "/app.jsonl";
    const { vfs } = fakeKernel({ [path]: "one\ntwo\n" });
    expect(await readLogTail(vfs, path, 1024)).toEqual({
      ok: true,
      text: "one\ntwo\n",
      truncated: false,
    });
  });

  it("returns a bounded tail cut at a line boundary", async () => {
    const path = LOGS_DIR + "/app.jsonl";
    const { vfs } = fakeKernel({ [path]: "aa\nbb\ncc\ndd\n" });
    const result = await readLogTail(vfs, path, 7);
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (!result.ok) return;
    expect(result.text).toBe("cc\ndd\n");
    expect(result.text.length).toBeLessThanOrEqual(7);
  });

  it("uses the documented 256 KiB window by default", async () => {
    const path = LOGS_DIR + "/access.jsonl";
    const line = '{"kind":"access","path":"/api/todos"}\n';
    const count = Math.ceil((LOG_TAIL_BYTES * 2) / line.length);
    const { vfs } = fakeKernel({ [path]: line.repeat(count) });
    const result = await readLogTail(vfs, path);
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (!result.ok) return;
    expect(result.text.length).toBeLessThanOrEqual(LOG_TAIL_BYTES);
    expect(result.text.startsWith("{")).toBe(true);
  });

  it("reports a missing file as an error", async () => {
    const { vfs } = fakeKernel({});
    expect(await readLogTail(vfs, LOGS_DIR + "/error.jsonl")).toEqual({
      ok: false,
      error: "ENOENT: " + LOGS_DIR + "/error.jsonl",
    });
  });
});

describe("loadLogs", () => {
  it("selects the first file and assumes its kind for lines that lack one", async () => {
    const access = LOGS_DIR + "/access.jsonl";
    const { vfs } = fakeKernel({
      [access]: '{"level":"info","method":"GET","path":"/x","status":401}\n',
      [LOGS_DIR + "/audit.1.jsonl"]: '{"kind":"audit","level":"info","event":"x"}\n',
    });
    const result = await loadLogs(vfs, "/p");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.dir).toBe(LOGS_DIR);
    expect(result.data.selected?.name).toBe("access.jsonl");
    expect(result.data.entries[0]?.kind).toBe("access");
    expect(result.data.entries[0]?.summary).toBe("GET /x 401");
    expect(result.data.truncated).toBe(false);
  });

  it("reads the file named by the caller", async () => {
    const { vfs } = fakeKernel({
      [LOGS_DIR + "/access.jsonl"]: '{"kind":"access","level":"info","path":"/a"}\n',
      [LOGS_DIR + "/error.jsonl"]:
        '{"kind":"error","level":"error","code":"boom","message":"bad"}\n',
    });
    const result = await loadLogs(vfs, "/p", { selectedName: "error.jsonl" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.selected?.kind).toBe("error");
    expect(result.data.entries[0]?.summary).toBe("boom: bad");
  });

  it("falls back to the first file when the named one disappeared (rotation)", async () => {
    const { vfs } = fakeKernel({
      [LOGS_DIR + "/access.1.jsonl"]: '{"kind":"access","level":"info","path":"/a"}\n',
    });
    const result = await loadLogs(vfs, "/p", { selectedName: "access.jsonl" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.selected?.name).toBe("access.1.jsonl");
  });

  it("returns empty data when no log file exists", async () => {
    const { vfs } = fakeKernel({});
    const result = await loadLogs(vfs, "/p");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.files).toEqual([]);
    expect(result.data.selected).toBeNull();
    expect(result.data.entries).toEqual([]);
  });

  it("propagates a tail read failure", async () => {
    const path = LOGS_DIR + "/access.jsonl";
    const kernel = fakeKernel({ [path]: "x\n" });
    const failing: LogsVfs = {
      request: async (type, payload) => {
        if (type === "vv-read-bytes") return { ok: false, error: "EIO" };
        return kernel.vfs.request(type, payload);
      },
    };
    expect(await loadLogs(failing, "/p")).toEqual({ ok: false, error: "EIO" });
  });
});
