import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRepoRef } from "./git-provider";
import type { PushOptions } from "./git-push";
import { listGiteaTree, pushGitea } from "./gitea-push";

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
  provider: "gitea",
  api: "https://gitea.example.com/api/v1",
  owner: "acme",
  repo: "site",
};
const repo = "https://gitea.example.com/api/v1/repos/acme/site";

function options(overrides: Partial<PushOptions> = {}): PushOptions {
  return {
    ref,
    token: "gitea_secret",
    branch: "main",
    headSha: "head1",
    message: "Publish",
    changes: {
      added: [{ path: "src/new.ts", bytes: bytes("new") }],
      modified: [{ path: "README.md", bytes: bytes("hello") }],
      deleted: ["old.txt"],
    },
    identity: { name: "Ada", email: "ada@example.com" },
    ...overrides,
  };
}

describe("listGiteaTree", () => {
  it("follows pages until an empty one and keeps only blob entries", async () => {
    queue(
      json({ default_branch: "main" }),
      json({ commit: { id: "head1" } }),
      json({
        tree: [
          { path: "README.md", type: "blob", sha: "b1" },
          { path: "src", type: "tree", sha: "t1" },
          { path: "vendor/lib", type: "commit", sha: "s1" },
        ],
      }),
      json({ tree: [] }),
    );
    const listing = await listGiteaTree(ref, "gitea_secret");
    expect(listing).toEqual({
      entries: [{ path: "README.md", sha: "b1" }],
      headSha: "head1",
      defaultBranch: "main",
    });
    const c = calls();
    expect(c[0].url).toBe(repo);
    expect(c[1].url).toBe(repo + "/branches/main");
    expect(c[2].url).toBe(repo + "/git/trees/main?recursive=true&per_page=100&page=1");
    expect(c[3].url).toBe(repo + "/git/trees/main?recursive=true&per_page=100&page=2");
    expect(c[0].headers.Authorization).toBe("token gitea_secret");
    for (const call of c) expect(call.url).not.toContain("gitea_secret");
  });

  it("lists an explicitly named branch, not the default one", async () => {
    queue(
      json({ default_branch: "main" }),
      json({ commit: { id: "head-dev" } }),
      json({ tree: [] }),
    );
    const listing = await listGiteaTree(ref, "t", "dev");
    expect(listing.headSha).toBe("head-dev");
    expect(calls()[1].url).toBe(repo + "/branches/dev");
    expect(calls()[2].url).toContain("/git/trees/dev?");
  });

  it("refuses a truncated tree instead of guessing at deletions", async () => {
    queue(
      json({ default_branch: "main" }),
      json({ commit: { id: "head1" } }),
      json({ tree: [], truncated: true }),
    );
    await expect(listGiteaTree(ref, "t")).rejects.toThrow(/too large to plan a safe push/);
  });

  it("distinguishes a missing repository from a missing branch", async () => {
    queue(json({ message: "404" }, 404));
    await expect(listGiteaTree(ref, "t")).rejects.toThrow(
      /Repository acme\/site was not found on Gitea/,
    );
    fetchMock.mockReset();
    queue(json({ default_branch: "main" }), json({ message: "404" }, 404));
    await expect(listGiteaTree(ref, "t", "dev")).rejects.toThrow(
      /Branch dev was not found on Gitea/,
    );
  });
});

describe("pushGitea", () => {
  it("writes each file as its own commit and reports the real count", async () => {
    queue(
      json({ commit: { id: "head1" } }),
      json({
        tree: [
          { path: "README.md", type: "blob", sha: "r1" },
          { path: "old.txt", type: "blob", sha: "r2" },
        ],
      }),
      json({ tree: [] }),
      json({ commit: { sha: "c1" } }),
      json({ commit: { sha: "c2" } }),
      json({ commit: { sha: "c3" } }),
    );
    const result = await pushGitea(options());
    expect(result).toEqual({ commitSha: "c3", branch: "main", commits: 3 });

    const c = calls();
    expect(c.map((call) => call.method)).toEqual(["GET", "GET", "GET", "POST", "PUT", "DELETE"]);
    expect(c[0].url).toBe(repo + "/branches/main");
    expect(c[3].url).toBe(repo + "/contents/src/new.ts");
    expect(c[3].body).toEqual({ content: "bmV3", message: "Publish", branch: "main" });
    expect(c[4].url).toBe(repo + "/contents/README.md");
    expect(c[4].body).toEqual({
      content: "aGVsbG8=",
      message: "Publish",
      sha: "r1",
      branch: "main",
    });
    expect(c[5].url).toBe(repo + "/contents/old.txt");
    expect(c[5].body).toEqual({ message: "Publish", sha: "r2", branch: "main" });
    for (const call of c) {
      expect(call.headers.Authorization).toBe("token gitea_secret");
      expect(call.url).not.toContain("gitea_secret");
    }
  });

  it("creates the branch on the first write and then targets it", async () => {
    queue(
      json({ commit: { id: "head1" } }),
      json({ commit: { sha: "c1" } }),
      json({ commit: { sha: "c2" } }),
    );
    const result = await pushGitea(
      options({
        branch: "feat/x",
        baseBranch: "main",
        changes: {
          added: [
            { path: "a b.txt", bytes: bytes("a") },
            { path: "b.txt", bytes: bytes("b") },
          ],
          modified: [],
          deleted: [],
        },
      }),
    );
    expect(result.commits).toBe(2);
    const c = calls();
    expect(c[0].url).toBe(repo + "/branches/main");
    expect(c[1].url).toBe(repo + "/contents/a%20b.txt");
    expect(c[1].body).toEqual({
      content: "YQ==",
      message: "Publish",
      branch: "main",
      new_branch: "feat/x",
    });
    expect(c[2].body).toEqual({ content: "Yg==", message: "Publish", branch: "feat/x" });
  });

  it("refuses when the branch moved since the diff was computed", async () => {
    queue(json({ commit: { id: "moved" } }));
    await expect(pushGitea(options())).rejects.toThrow(/moved while planning/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses when a planned update path vanished from the branch", async () => {
    queue(json({ commit: { id: "head1" } }), json({ tree: [] }));
    await expect(pushGitea(options())).rejects.toThrow(/moved while planning/);
  });

  it("maps HTTP failures to actionable messages", async () => {
    const cases: { response: Response | Error; pattern: RegExp }[] = [
      { response: json({ message: "401" }, 401), pattern: /rejected the token/ },
      { response: json({ message: "403" }, 403), pattern: /write:repository/ },
      { response: json({ message: "404" }, 404), pattern: /Branch main was not found on Gitea/ },
      { response: json({ message: "409" }, 409), pattern: /moved while planning/ },
      { response: json({ message: "boom" }, 500), pattern: /Gitea request failed \(HTTP 500\)/ },
      { response: new TypeError("Failed to fetch"), pattern: /Could not reach Gitea.*CORS/ },
    ];
    for (const { response, pattern } of cases) {
      fetchMock.mockReset();
      if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
      else fetchMock.mockResolvedValueOnce(response);
      await expect(pushGitea(options())).rejects.toThrow(pattern);
    }
  });

  it("never leaks the token into an error message", async () => {
    for (const status of [401, 403, 404, 409, 422, 500]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(json({ message: "token gitea_secret rejected" }, status));
      const error = await rejection(pushGitea(options()));
      expect(error.message).not.toContain("gitea_secret");
    }
  });
});
