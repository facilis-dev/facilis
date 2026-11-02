import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KernelBridge } from "./kernel";
import { CommitGraphSession } from "./commit-graph-session";

const mocks = vi.hoisted(() => ({
  loadGit: vi.fn(),
  createGitFs: vi.fn(),
}));

vi.mock("./git-api", () => ({ loadGit: mocks.loadGit }));
vi.mock("./git-fs", () => ({ createGitFs: mocks.createGitFs }));

interface StatLike {
  isDirectory(): boolean;
}

interface LogEntryLike {
  oid: string;
  commit: {
    message: string;
    parent: string[];
    author: { name: string; timestamp: number };
  };
}

function entry(
  oid: string,
  parents: string[],
  timestamp: number,
  message = "commit " + oid,
  author = "Ada",
): LogEntryLike {
  return { oid, commit: { message, parent: parents, author: { name: author, timestamp } } };
}

function fakeGit(repo: {
  head?: string | null;
  branches?: string[];
  refs?: Record<string, string>;
  logs?: Record<string, LogEntryLike[]>;
}) {
  return {
    currentBranch: vi.fn(async () => repo.head ?? null),
    listBranches: vi.fn(async () => repo.branches ?? []),
    resolveRef: vi.fn(async ({ ref }: { ref: string }) => {
      const name = ref.replace(/^refs\/heads\//, "");
      const oid = repo.refs?.[name];
      if (oid === undefined) throw new Error("ENOENT: " + ref);
      return oid;
    }),
    log: vi.fn(async ({ ref }: { ref: string }) => repo.logs?.[ref] ?? []),
  };
}

function fakeFs(stat: (path: string) => Promise<StatLike>) {
  return { promises: { stat } };
}

const dirStat = async (): Promise<StatLike> => ({ isDirectory: () => true });

function bridge(): KernelBridge {
  return {} as unknown as KernelBridge;
}

function sessionFor(git: unknown, stat: (path: string) => Promise<StatLike> = dirStat) {
  mocks.createGitFs.mockReturnValue(fakeFs(stat));
  mocks.loadGit.mockResolvedValue(git);
  return new CommitGraphSession(bridge());
}

beforeEach(() => {
  mocks.loadGit.mockReset();
  mocks.createGitFs.mockReset();
});

describe("CommitGraphSession.load state", () => {
  it("reports a folder without .git without loading isomorphic-git", async () => {
    const stat = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    const session = sessionFor(undefined, stat);
    await expect(session.load("/w/app")).resolves.toEqual({
      ok: false,
      error: "not a git repository",
    });
    expect(stat).toHaveBeenCalledWith("/w/app/.git");
    expect(mocks.loadGit).not.toHaveBeenCalled();
  });

  it("reports a .git that is not a directory", async () => {
    const session = sessionFor(undefined, async () => ({ isDirectory: () => false }));
    await expect(session.load("/w/app/")).resolves.toEqual({
      ok: false,
      error: "not a git repository",
    });
  });

  it("wraps a failed read in ok:false with the error message", async () => {
    const session = sessionFor(undefined);
    mocks.loadGit.mockRejectedValue(new Error("boom"));
    await expect(session.load("/w/app")).resolves.toEqual({ ok: false, error: "boom" });
  });
});

describe("CommitGraphSession.load graph", () => {
  it("merges the logs of every branch, marks HEAD and skips stale refs", async () => {
    const git = fakeGit({
      head: "main",
      branches: ["main", "feature", "stale"],
      refs: { main: "m1", feature: "f1" },
      logs: {
        main: [
          entry("m1", ["f1", "a1"], 300, "Merge feature\n\nBody", "Ada"),
          entry("a1", [], 100),
        ],
        feature: [entry("f1", ["a1"], 200, "Feature", "Bob")],
      },
    });
    const read = await sessionFor(git).load("/w/app");
    if (!read.ok) throw new Error("expected a graph, got " + read.error);

    expect(read.graph.head).toBe("main");
    expect(read.graph.headOid).toBe("m1");
    expect(read.graph.branches).toEqual([
      { name: "main", oid: "m1" },
      { name: "feature", oid: "f1" },
    ]);
    expect(read.graph.stats).toEqual({ commits: 3, branches: 2, lanes: 2 });
    expect(read.graph.nodes.map((node) => node.id)).toEqual(["m1", "f1", "a1"]);
    expect(read.graph.nodes[0].data.message).toBe("Merge feature");
    expect(read.graph.nodes[0].data.parents).toEqual(["f1", "a1"]);
    expect(read.graph.nodes[0].data.author).toBe("Ada");
    expect(read.graph.nodes[0].data.head).toBe(true);

    expect(git.log).toHaveBeenCalledWith(expect.objectContaining({ ref: "main", depth: 60 }));
    expect(git.log).toHaveBeenCalledWith(expect.objectContaining({ ref: "feature", depth: 60 }));
    expect(git.log).not.toHaveBeenCalledWith(expect.objectContaining({ ref: "HEAD" }));
    expect(git.resolveRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "refs/heads/main" }),
    );
    expect(git.resolveRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "refs/heads/stale" }),
    );
  });

  it("reads HEAD as well when it is detached", async () => {
    const git = fakeGit({
      head: null,
      branches: ["main"],
      refs: { main: "m1" },
      logs: {
        main: [entry("m1", [], 100)],
        HEAD: [entry("h1", ["m1"], 300)],
      },
    });
    const read = await sessionFor(git).load("/w/app");
    if (!read.ok) throw new Error("expected a graph, got " + read.error);

    expect(read.graph.head).toBeNull();
    expect(read.graph.headOid).toBeNull();
    expect(read.graph.nodes.map((node) => node.id)).toEqual(["h1", "m1"]);
    expect(read.graph.nodes[0].data.head).toBe(false);
    expect(git.log).toHaveBeenCalledWith(expect.objectContaining({ ref: "HEAD" }));
  });

  it("honours the depth and limit options", async () => {
    const git = fakeGit({
      head: "main",
      branches: ["main"],
      refs: { main: "c3" },
      logs: {
        main: [entry("c3", ["c2"], 300), entry("c2", ["c1"], 200), entry("c1", [], 100)],
      },
    });
    const read = await sessionFor(git).load("/w/app", { depth: 2, limit: 2 });
    if (!read.ok) throw new Error("expected a graph, got " + read.error);

    expect(read.graph.nodes.map((node) => node.id)).toEqual(["c3", "c2"]);
    expect(git.log).toHaveBeenCalledWith(expect.objectContaining({ depth: 2 }));
  });

  it("orders equal timestamps by oid so repeated reads draw the same graph", async () => {
    const git = fakeGit({
      head: null,
      branches: ["feature"],
      refs: { feature: "b" },
      logs: {
        feature: [entry("b", [], 100)],
        HEAD: [entry("a", [], 100)],
      },
    });
    const read = await sessionFor(git).load("/w/app");
    if (!read.ok) throw new Error("expected a graph, got " + read.error);
    expect(read.graph.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  });
});
