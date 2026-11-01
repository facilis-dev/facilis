import { describe, expect, it, vi } from "vitest";
import type { KernelBridge, KernelMessage } from "./kernel";
import {
  SearchSession,
  type SearchDone,
  type SearchFileResult,
  type SearchOptions,
} from "./search-session";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const OPTS: SearchOptions = {
  query: "x",
  matchCase: false,
  wholeWord: false,
  regex: false,
  includeGlob: "",
  excludeGlob: "",
};

function file(path: string, matches = 1): SearchFileResult {
  return {
    file: path,
    root: "/p",
    matches: Array.from({ length: matches }, (_, i) => ({
      line: i + 1,
      column: 1,
      length: 1,
      preview: "x",
    })),
  };
}

function createSession(ignored: string[] = []) {
  const post = vi.fn();
  const bridge = { post, request: vi.fn() } as unknown as KernelBridge;
  const session = new SearchSession(bridge, {
    roots: () => ["/p"],
    refreshFileFromDisk: async () => {},
    isIgnored: (abs) => ignored.includes(abs),
  });
  return { session, post };
}

function started(session: SearchSession, post: ReturnType<typeof vi.fn>) {
  const batches: SearchFileResult[] = [];
  let done: SearchDone | null = null;
  session.run(OPTS, {
    onBatch: (files) => batches.push(...files),
    onDone: (d) => {
      done = d;
    },
  });
  const sent = post.mock.calls[0]?.[1] as { token: number };
  return { batches, done: () => done, token: sent.token };
}

describe("SearchSession ignored-file filter", () => {
  it("drops ignored files from batches and from the summary counts", () => {
    const { session, post } = createSession(["/p/debug.log", "/p/only.log"]);
    const { batches, done, token } = started(session, post);

    session.onResult({
      token,
      files: [file("/p/debug.log", 3), file("/p/app.ts", 2)],
    } as unknown as KernelMessage);
    session.onResult({ token, files: [file("/p/only.log", 1)] } as unknown as KernelMessage);
    session.onDone({
      token,
      matchCount: 6,
      fileCount: 3,
      limitHit: false,
    } as unknown as KernelMessage);

    expect(batches.map((f) => f.file)).toEqual(["/p/app.ts"]);
    expect(done()).toEqual({ matchCount: 2, fileCount: 1, limitHit: false, error: undefined });
  });

  it("passes the kernel counts through when nothing was filtered", () => {
    const { session, post } = createSession();
    const { batches, done, token } = started(session, post);

    session.onResult({ token, files: [file("/p/app.ts", 2)] } as unknown as KernelMessage);
    session.onDone({
      token,
      matchCount: 2,
      fileCount: 1,
      limitHit: false,
    } as unknown as KernelMessage);

    expect(batches).toHaveLength(1);
    expect(done()).toEqual({ matchCount: 2, fileCount: 1, limitHit: false, error: undefined });
  });

  it("ignores results from a superseded search", () => {
    const { session, post } = createSession();
    const { batches, token } = started(session, post);

    session.onResult({ token: token + 1, files: [file("/p/app.ts")] } as unknown as KernelMessage);

    expect(batches).toEqual([]);
  });
});
