import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listGithubTree, pushGithub } from "./github-push";
import type { GitRepoRef } from "./git-provider";
import type { PushOptions } from "./git-push";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function queue(...responses: Response[]): void {
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
}

function calls(): Call[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: String(init?.method ?? "GET").toUpperCase(),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
  }));
}

const bytes = (text: string) => new TextEncoder().encode(text);

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to reject");
}

const ref: GitRepoRef = {
  provider: "github",
  api: "https://api.github.com",
  owner: "acme",
  repo: "site",
};

function options(overrides: Partial<PushOptions> = {}): PushOptions {
  return {
    ref,
    token: "ghp_secret",
    branch: "main",
    headSha: "head1",
    message: "Update site",
    changes: {
      added: [{ path: "src/new.ts", bytes: bytes("new") }],
      modified: [{ path: "README.md", bytes: bytes("hello") }],
      deleted: ["old.txt"],
    },
    identity: { name: "Ada", email: "ada@example.com" },
    ...overrides,
  };
}

describe("listGithubTree", () => {
  it("resolves the default branch and keeps only blob entries", async () => {
    queue(
      json({ default_branch: "main" }),
      json({ object: { sha: "head1" } }),
      json({
        tree: [
          { path: "README.md", type: "blob", sha: "b1" },
          { path: "src", type: "tree", sha: "t1" },
          { path: "vendor/lib", type: "commit", sha: "s1" },
          { path: "src/app.ts", type: "blob", sha: "b2" },
        ],
      }),
    );
    const listing = await listGithubTree(ref, "ghp_secret");
    expect(listing).toEqual({
      entries: [
        { path: "README.md", sha: "b1" },
        { path: "src/app.ts", sha: "b2" },
      ],
      headSha: "head1",
      defaultBranch: "main",
    });
    const [repo, head, tree] = calls();
    expect(repo.url).toBe("https://api.github.com/repos/acme/site");
    expect(head.url).toBe("https://api.github.com/repos/acme/site/git/ref/heads/main");
    expect(tree.url).toBe("https://api.github.com/repos/acme/site/git/trees/main?recursive=1");
    expect(repo.headers.Authorization).toBe("Bearer ghp_secret");
    for (const call of calls()) expect(call.url).not.toContain("ghp_secret");
  });

  it("lists an explicitly named branch, not the default one", async () => {
    queue(
      json({ default_branch: "main" }),
      json({ object: { sha: "head-dev" } }),
      json({ tree: [{ path: "dev.txt", type: "blob", sha: "d1" }] }),
    );
    const listing = await listGithubTree(ref, "t", "dev");
    expect(listing.defaultBranch).toBe("main");
    expect(listing.headSha).toBe("head-dev");
    expect(calls()[1].url).toContain("/git/ref/heads/dev");
    expect(calls()[2].url).toContain("/git/trees/dev?recursive=1");
  });

  it("refuses a tree the host truncated instead of guessing at deletions", async () => {
    queue(
      json({ default_branch: "main" }),
      json({ object: { sha: "head1" } }),
      json({ tree: [], truncated: true }),
    );
    await expect(listGithubTree(ref, "t")).rejects.toThrow(/too large to plan a safe push/);
  });

  it("distinguishes a missing repository from a missing branch", async () => {
    queue(json({ message: "Not Found" }, 404));
    await expect(listGithubTree(ref, "t")).rejects.toThrow(
      /Repository acme\/site was not found on GitHub/,
    );
    fetchMock.mockReset();
    queue(json({ default_branch: "main" }), json({ message: "Not Found" }, 404));
    await expect(listGithubTree(ref, "t", "dev")).rejects.toThrow(
      /Branch dev was not found on GitHub/,
    );
  });
});

describe("pushGithub", () => {
  it("creates one commit with every change and moves the branch without force", async () => {
    queue(
      json({ object: { sha: "head1" } }),
      json({ sha: "blob1" }),
      json({ sha: "blob2" }),
      json({ tree: { sha: "base-tree" } }),
      json({ sha: "tree1" }),
      json({ sha: "commit1" }),
      json({ object: { sha: "commit1" } }),
    );
    const result = await pushGithub(options());
    expect(result).toEqual({ commitSha: "commit1", branch: "main", commits: 1 });

    const c = calls();
    expect(c.map((call) => call.method)).toEqual([
      "GET",
      "POST",
      "POST",
      "GET",
      "POST",
      "POST",
      "PATCH",
    ]);
    expect(c[0].url).toBe("https://api.github.com/repos/acme/site/git/ref/heads/main");
    expect(c[1].url).toBe("https://api.github.com/repos/acme/site/git/blobs");
    expect(c[1].body).toEqual({ content: "bmV3", encoding: "base64" });
    expect(c[2].body).toEqual({ content: "aGVsbG8=", encoding: "base64" });
    expect(c[3].url).toContain("/git/commits/head1");
    expect(c[4].body).toEqual({
      base_tree: "base-tree",
      tree: [
        { path: "src/new.ts", mode: "100644", type: "blob", sha: "blob1" },
        { path: "README.md", mode: "100644", type: "blob", sha: "blob2" },
        { path: "old.txt", mode: "100644", type: "blob", sha: null },
      ],
    });
    expect(c[5].body).toEqual({
      message: "Update site",
      tree: "tree1",
      parents: ["head1"],
      author: { name: "Ada", email: "ada@example.com" },
    });
    expect(c[6].url).toBe("https://api.github.com/repos/acme/site/git/refs/heads/main");
    expect(c[6].body).toEqual({ sha: "commit1", force: false });
    expect(c[5].headers["Content-Type"]).toBe("application/json");
    for (const call of c) {
      expect(call.headers.Authorization).toBe("Bearer ghp_secret");
      expect(call.url).not.toContain("ghp_secret");
    }
  });

  it("encodes arbitrary binary bytes without losing them", async () => {
    queue(
      json({ object: { sha: "head1" } }),
      json({ sha: "blob1" }),
      json({ tree: { sha: "base" } }),
      json({ sha: "tree1" }),
      json({ sha: "commit1" }),
      json({}),
    );
    await pushGithub(
      options({
        changes: {
          added: [{ path: "a.bin", bytes: new Uint8Array([0, 255, 128]) }],
          modified: [],
          deleted: [],
        },
      }),
    );
    expect(calls()[1].body).toEqual({ content: "AP+A", encoding: "base64" });
  });

  it("creates a branch from baseBranch instead of moving it", async () => {
    queue(
      json({ object: { sha: "head1" } }),
      json({ sha: "blob1" }),
      json({ tree: { sha: "base" } }),
      json({ sha: "tree1" }),
      json({ sha: "commit1" }),
      json({ object: { sha: "commit1" } }),
    );
    const result = await pushGithub(
      options({
        branch: "feat/x",
        baseBranch: "main",
        changes: { added: [{ path: "a.txt", bytes: bytes("a") }], modified: [], deleted: [] },
      }),
    );
    expect(result.branch).toBe("feat/x");
    const c = calls();
    expect(c[0].url).toContain("/git/ref/heads/main");
    expect(c[5].method).toBe("POST");
    expect(c[5].url).toBe("https://api.github.com/repos/acme/site/git/refs");
    expect(c[5].body).toEqual({ ref: "refs/heads/feat/x", sha: "commit1" });
  });

  it("refuses when the branch moved since the diff was computed", async () => {
    queue(json({ object: { sha: "moved" } }));
    await expect(pushGithub(options())).rejects.toThrow(/moved while planning/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP failures to actionable messages", async () => {
    const cases: { response: Response | Error; pattern: RegExp }[] = [
      { response: json({ message: "Bad credentials" }, 401), pattern: /rejected the token/ },
      { response: json({ message: "Forbidden" }, 403), pattern: /contents: write/ },
      {
        response: json({ message: "Not Found" }, 404),
        pattern: /Branch main was not found on GitHub/,
      },
      { response: json({ message: "Conflict" }, 409), pattern: /moved while planning/ },
      { response: json({ message: "Boom" }, 500), pattern: /GitHub request failed \(HTTP 500\)/ },
      { response: new TypeError("Failed to fetch"), pattern: /Could not reach GitHub.*CORS/ },
    ];
    for (const { response, pattern } of cases) {
      fetchMock.mockReset();
      if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
      else fetchMock.mockResolvedValueOnce(response);
      await expect(pushGithub(options())).rejects.toThrow(pattern);
    }
  });

  it("never leaks the token into an error message", async () => {
    for (const status of [401, 403, 404, 409, 422, 500]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(json({ message: "token ghp_secret rejected" }, status));
      const error = await rejection(pushGithub(options()));
      expect(error.message).not.toContain("ghp_secret");
    }
  });
});
