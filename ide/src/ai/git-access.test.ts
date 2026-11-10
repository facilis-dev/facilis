import { describe, expect, it } from "vitest";
import { createGitAccessFromPorts } from "./git-access";
import { change, fakePorts, viewOf } from "./git-access-fixtures";

describe("git_status / git_diff / git_log / git_branches / git_remote", () => {
  it("reports branch, changes and the remote ahead/behind", async () => {
    const fake = fakePorts({
      repo: { staged: [change("src/a.ts")], changes: [change("src/b.ts", "U")] },
    });
    const view = await viewOf(createGitAccessFromPorts(fake.ports).status());
    expect(view).toMatchObject({
      branch: "main",
      staged: [{ path: "src/a.ts", letter: "M" }],
      changes: [{ path: "src/b.ts", letter: "U" }],
      remote: { ahead: 1, behind: 2, url: "https://github.com/acme/app.git" },
    });
  });

  it("returns no-project and no-repository as data", async () => {
    expect(
      await viewOf(createGitAccessFromPorts(fakePorts({ root: null }).ports).status()),
    ).toMatchObject({ available: false });
    const noRepo = await viewOf(createGitAccessFromPorts(fakePorts({ repo: null }).ports).status());
    expect(noRepo.reason).toContain("not a git repository");
  });

  it("diffs unstaged (index to worktree) and staged (HEAD to index) changes", async () => {
    const unstaged = await viewOf(
      createGitAccessFromPorts(fakePorts({ repo: { changes: [change("src/a.ts")] } }).ports).diff({
        staged: false,
      }),
    );
    expect(unstaged.diff).toContain("--- a/src/a.ts");
    expect(unstaged.diff).toContain("+three");
    expect(unstaged.files).toEqual([{ path: "src/a.ts", added: 1, removed: 0 }]);
    const staged = await viewOf(
      createGitAccessFromPorts(fakePorts({ repo: { staged: [change("src/a.ts")] } }).ports).diff({
        staged: true,
      }),
    );
    expect(staged.diff).toContain("-two");
    expect(staged.diff).toContain("+TWO");
  });

  it("filters a path, reports nothing to diff and marks binary files", async () => {
    const access = createGitAccessFromPorts(
      fakePorts({ repo: { changes: [change("src/a.ts")] } }).ports,
    );
    expect(await viewOf(access.diff({ staged: false, path: "src/other.ts" }))).toMatchObject({
      diff: "",
      files: [],
    });
    const binary = fakePorts({
      repo: { changes: [change("logo.png")] },
      contents: {
        workdir: async (_root, paths) => new Map(paths.map((path) => [path, "a\u0000b"])),
      },
    });
    expect(
      (await viewOf(createGitAccessFromPorts(binary.ports).diff({ staged: false }))).files,
    ).toEqual([{ path: "logo.png", binary: true }]);
  });

  it("reports recent commits with a short oid, author and ISO timestamp", async () => {
    const commits = (await viewOf(createGitAccessFromPorts(fakePorts().ports).log(5)))
      .commits as Record<string, unknown>[];
    expect(commits[0]).toMatchObject({ short: "0123456", message: "first line", author: "Ann" });
    expect(commits[0]?.["timestamp"]).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("lists the current and local branches", async () => {
    const branches = await viewOf(createGitAccessFromPorts(fakePorts().ports).branches());
    expect(branches).toMatchObject({ current: "main", branches: ["main"], detached: false });
  });

  it("parses the origin remote and reports proxy availability", async () => {
    const remote = await viewOf(createGitAccessFromPorts(fakePorts().ports).remote());
    expect(remote).toMatchObject({
      remote: { name: "origin", url: "https://github.com/acme/app.git" },
      provider: "github",
      owner: "acme",
      repo: "app",
      proxy: { configured: "same-origin", available: true },
      ahead: 1,
      behind: 2,
    });
  });

  it("reports availability from the open project", () => {
    expect(createGitAccessFromPorts(fakePorts().ports).available()).toBe(true);
    expect(createGitAccessFromPorts(fakePorts({ root: null }).ports).available()).toBe(false);
  });
});

describe("git_stage / git_unstage / git_commit / git_branch", () => {
  it("stages known paths and refuses unknown ones without staging anything", async () => {
    const fake = fakePorts({ repo: { changes: [change("src/a.ts")] } });
    const access = createGitAccessFromPorts(fake.ports);
    expect(await viewOf(access.stage(["src/a.ts"]))).toMatchObject({
      ok: true,
      staged: ["src/a.ts"],
    });
    expect(fake.calls).toContain("stage:src/a.ts");
    const missing = await viewOf(access.stage(["nope.ts"]));
    expect(missing).toMatchObject({ ok: false });
    expect(missing.reason).toContain("no unstaged change");
  });

  it("unstages everything or the named paths", async () => {
    const all = fakePorts({ repo: { staged: [change("src/a.ts")] } });
    expect(await viewOf(createGitAccessFromPorts(all.ports).unstage())).toMatchObject({
      ok: true,
      unstaged: ["src/a.ts"],
    });
    expect(all.calls).toContain("unstageAll");
    const named = fakePorts({ repo: { staged: [change("src/a.ts")] } });
    expect(await viewOf(createGitAccessFromPorts(named.ports).unstage(["src/a.ts"]))).toMatchObject(
      { ok: true },
    );
    expect(named.calls).toContain("unstage:src/a.ts");
    expect(
      await viewOf(createGitAccessFromPorts(named.ports).unstage(["missing.ts"])),
    ).toMatchObject({ ok: false });
  });

  it("commits staged changes, refuses an empty index and reports a failure", async () => {
    const fake = fakePorts({ repo: { staged: [change("src/a.ts")] } });
    const view = await viewOf(createGitAccessFromPorts(fake.ports).commit("feat: x"));
    expect(view.ok).toBe(true);
    expect(view.note).toContain("local");
    expect(fake.calls).toContain("commit:feat: x");
    const empty = await viewOf(
      createGitAccessFromPorts(fakePorts({ repo: { changes: [change("src/a.ts")] } }).ports).commit(
        "x",
      ),
    );
    expect(empty.reason).toContain("nothing is staged");
    const failing = await viewOf(
      createGitAccessFromPorts(
        fakePorts({ repo: { staged: [change("src/a.ts")] }, commitOk: false }).ports,
      ).commit("x"),
    );
    expect(failing.reason).toContain("git name and email");
  });

  it("creates and switches branches, refusing a dirty tree on switch", async () => {
    const fake = fakePorts();
    const access = createGitAccessFromPorts(fake.ports);
    expect(await viewOf(access.branch("create", "feature/x"))).toMatchObject({
      ok: true,
      branch: "feature/x",
    });
    expect(fake.calls).toContain("createBranch:feature/x");
    expect(await viewOf(access.branch("create", "feature/x"))).toMatchObject({ ok: false });
    const dirty = fakePorts({
      repo: { branches: ["main", "dev"], changes: [change("src/a.ts")] },
    });
    const refused = await viewOf(createGitAccessFromPorts(dirty.ports).branch("switch", "dev"));
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain("uncommitted changes");
    expect(dirty.calls).not.toContain("checkoutBranch:dev");
    const clean = fakePorts({ repo: { branches: ["main", "dev"] } });
    expect(
      await viewOf(createGitAccessFromPorts(clean.ports).branch("switch", "dev")),
    ).toMatchObject({ ok: true, action: "switch", branch: "dev" });
    expect(
      await viewOf(
        createGitAccessFromPorts(fakePorts({ repo: { branches: ["main"] } }).ports).branch(
          "switch",
          "nope",
        ),
      ),
    ).toMatchObject({ ok: false });
  });
});
