import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDeployment } from "@/deploy/resolve";
import { gitBlobSha } from "./git-blobs";
import { listRemoteTree, pushChanges, type PushOptions, type RemoteListing } from "./git-push";
import { isExcludedPushPath, ProjectPublish } from "./project-publish";

// The host calls are the adapter's contract (git-push.test.ts covers them); these tests
// pin the orchestration: which branch the diff targets, what a push sends, and what the
// dialog is allowed to do in a managed build.
vi.mock("./git-push", () => ({
  listRemoteTree: vi.fn(),
  pushChanges: vi.fn(),
}));

const listMock = vi.mocked(listRemoteTree);
const pushMock = vi.mocked(pushChanges);

const bytes = (text: string) => new TextEncoder().encode(text);

function listing(entries: { path: string; sha: string }[] = []): RemoteListing {
  return { entries, headSha: "head1", defaultBranch: "main" };
}

function host(files: { path: string; text: string }[], truncated = false) {
  return {
    kernelReady: () => true,
    readTree: async () => ({
      files: files.map((file) => ({ path: file.path, bytes: bytes(file.text) })),
      truncated,
    }),
  };
}

const open = resolveDeployment({});
const managed = resolveDeployment({
  profile: "managed",
  company: { name: "Acme", domain: "facilis.acme.example" },
  packages: { registry: "https://npm.acme.example" },
  projects: { preview: { origin: "https://preview.facilis.acme.example" } },
});

const publish = (files: { path: string; text: string }[], profile = open) =>
  new ProjectPublish(host(files), profile);

const input = (overrides: Partial<Parameters<ProjectPublish["plan"]>[0]> = {}) => ({
  provider: "github" as const,
  repository: "acme/app",
  token: "ghp_token",
  ...overrides,
});

beforeEach(() => {
  listMock.mockReset();
  pushMock.mockReset();
  listMock.mockResolvedValue(listing());
});

describe("ProjectPublish.plan", () => {
  it("refuses when the deployment compiled the push out", async () => {
    await expect(
      publish([{ path: "README.md", text: "hi" }], managed).plan(input(), "/w/app"),
    ).rejects.toThrow(/does not allow publishing/);
  });

  it("requires a token and a parseable repository", async () => {
    const instance = publish([{ path: "README.md", text: "hi" }]);
    await expect(instance.plan(input({ token: "  " }), "/w/app")).rejects.toThrow(/token/);
    await expect(instance.plan(input({ repository: "nope" }), "/w/app")).rejects.toThrow(
      /repository URL/,
    );
  });

  it("diffs the project against the default branch by default", async () => {
    listMock.mockResolvedValue(
      listing([
        { path: "README.md", sha: gitBlobSha(bytes("old")) },
        { path: "gone.txt", sha: "deadbeef" },
      ]),
    );
    const plan = await publish([
      { path: "README.md", text: "new" },
      { path: "src/app.ts", text: "app" },
    ]).plan(input(), "/w/app");
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "github", owner: "acme", repo: "app" }),
      "ghp_token",
      undefined,
    );
    expect(plan.branch).toBe("main");
    expect(plan.baseBranch).toBe("main");
    expect(plan.changes).toEqual({
      added: ["src/app.ts"],
      modified: ["README.md"],
      deleted: ["gone.txt"],
    });
    expect(plan.adds.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(plan.updates.map((file) => file.path)).toEqual(["README.md"]);
    expect(plan.deletes).toEqual(["gone.txt"]);
    expect(plan.bytes).toBeGreaterThan(0);
  });

  it("lists the named branch when committing onto it", async () => {
    listMock.mockResolvedValue(listing([{ path: "README.md", sha: "abc" }]));
    const plan = await publish([{ path: "README.md", text: "hi" }]).plan(
      input({ branch: "release" }),
      "/w/app",
    );
    expect(listMock).toHaveBeenCalledWith(expect.anything(), "ghp_token", "release");
    expect(plan.branch).toBe("release");
    expect(plan.createBranch).toBe(false);
  });

  it("starts a new branch from the listed base and needs a name", async () => {
    const plan = await publish([{ path: "README.md", text: "hi" }]).plan(
      input({ branch: "facilis/2026-11-01", createBranch: true }),
      "/w/app",
    );
    expect(listMock).toHaveBeenCalledWith(expect.anything(), "ghp_token", undefined);
    expect(plan.branch).toBe("facilis/2026-11-01");
    expect(plan.baseBranch).toBe("main");
    expect(plan.createBranch).toBe(true);
    await expect(
      publish([{ path: "README.md", text: "hi" }]).plan(input({ createBranch: true }), "/w/app"),
    ).rejects.toThrow(/name for the new branch/);
  });

  it("never carries build output or machine-local state", async () => {
    const files = [
      { path: "dist/index.js", text: "built" },
      { path: "node_modules/x/index.js", text: "dep" },
      { path: ".facilis/db.sqlite", text: "db" },
      { path: "debug.log", text: "log" },
      { path: ".DS_Store", text: "junk" },
      { path: "src/main.ts", text: "main" },
    ];
    const plan = await publish(files).plan(input(), "/w/app");
    expect(plan.adds.map((file) => file.path)).toEqual(["src/main.ts"]);
    expect(isExcludedPushPath("a/node_modules/b")).toBe(true);
    expect(isExcludedPushPath("src/main.ts")).toBe(false);
  });

  it("reports a clean tree instead of an empty push", async () => {
    const text = "same";
    listMock.mockResolvedValue(listing([{ path: "README.md", sha: gitBlobSha(bytes(text)) }]));
    const instance = publish([{ path: "README.md", text }]);
    const plan = await instance.plan(input(), "/w/app");
    expect(plan.changes).toEqual({ added: [], modified: [], deleted: [] });
    await expect(
      instance.push(plan, {
        token: "ghp_token",
        message: "x",
        identity: { name: "A", email: "a@example.com" },
      }),
    ).rejects.toThrow(/Nothing to publish/);
  });
});

describe("ProjectPublish.push", () => {
  it("sends the planned changes with the author identity", async () => {
    listMock.mockResolvedValue(listing());
    pushMock.mockResolvedValue({ commitSha: "new", branch: "main", commits: 1 });
    const instance = publish([{ path: "src/app.ts", text: "app" }]);
    const plan = await instance.plan(input(), "/w/app");
    const result = await instance.push(plan, {
      token: "ghp_token",
      message: "  Add the app  ",
      identity: { name: "Ada", email: "ada@example.com" },
    });
    expect(result.commitSha).toBe("new");
    const sent = pushMock.mock.calls[0]?.[0] as PushOptions;
    expect(sent.message).toBe("Add the app");
    expect(sent.baseBranch).toBeUndefined();
    expect(sent.headSha).toBe("head1");
    expect(sent.identity).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(sent.changes.added.map((file) => file.path)).toEqual(["src/app.ts"]);
  });

  it("passes the start branch only when creating a branch", async () => {
    listMock.mockResolvedValue(listing());
    pushMock.mockResolvedValue({ commitSha: "new", branch: "facilis/x", commits: 1 });
    const instance = publish([{ path: "src/app.ts", text: "app" }]);
    const plan = await instance.plan(input({ branch: "facilis/x", createBranch: true }), "/w/app");
    await instance.push(plan, {
      token: "ghp_token",
      message: "Publish",
      identity: { name: "Ada", email: "ada@example.com" },
    });
    const sent = pushMock.mock.calls[0]?.[0] as PushOptions;
    expect(sent.branch).toBe("facilis/x");
    expect(sent.baseBranch).toBe("main");
  });

  it("refuses to act without an author identity", async () => {
    listMock.mockResolvedValue(listing());
    const instance = publish([{ path: "src/app.ts", text: "app" }]);
    const plan = await instance.plan(input(), "/w/app");
    await expect(
      instance.push(plan, {
        token: "ghp_token",
        message: "Publish",
        identity: { name: "", email: "" },
      }),
    ).rejects.toThrow(/author/);
  });
});
