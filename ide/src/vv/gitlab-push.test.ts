import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRepoRef } from "./git-provider";
import type { PushOptions } from "./git-push";
import { listGitlabTree, pushGitlab } from "./gitlab-push";

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
  provider: "gitlab",
  api: "https://gitlab.com/api/v4",
  owner: "group/sub",
  repo: "site",
};
const project = "https://gitlab.com/api/v4/projects/group%2Fsub%2Fsite";

function options(overrides: Partial<PushOptions> = {}): PushOptions {
  return {
    ref,
    token: "glpat_secret",
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

describe("listGitlabTree", () => {
  it("follows x-next-page and keeps only blob entries", async () => {
    queue(
      json({ default_branch: "main" }),
      json({ commit: { id: "head1" } }),
      json(
        [
          { type: "blob", path: "a.txt", id: "b1" },
          { type: "tree", path: "src", id: "t1" },
        ],
        200,
        { "x-next-page": "2" },
      ),
      json([{ type: "blob", path: "src/app.ts", id: "b2" }], 200, { "x-next-page": "" }),
    );
    const listing = await listGitlabTree(ref, "glpat_secret");
    expect(listing).toEqual({
      entries: [
        { path: "a.txt", sha: "b1" },
        { path: "src/app.ts", sha: "b2" },
      ],
      headSha: "head1",
      defaultBranch: "main",
    });
    const c = calls();
    expect(c[0].url).toBe(project);
    expect(c[1].url).toBe(project + "/repository/branches/main");
    expect(c[2].url).toBe(project + "/repository/tree?recursive=true&per_page=100&page=1&ref=main");
    expect(c[3].url).toBe(project + "/repository/tree?recursive=true&per_page=100&page=2&ref=main");
    expect(c[0].headers["PRIVATE-TOKEN"]).toBe("glpat_secret");
    for (const call of c) expect(call.url).not.toContain("glpat_secret");
  });

  it("lists an explicitly named branch, not the default one", async () => {
    queue(
      json({ default_branch: "main" }),
      json({ commit: { id: "head-dev" } }),
      json([{ type: "blob", path: "dev.txt", id: "d1" }], 200, { "x-next-page": "" }),
    );
    const listing = await listGitlabTree(ref, "t", "dev");
    expect(listing.headSha).toBe("head-dev");
    expect(calls()[1].url).toBe(project + "/repository/branches/dev");
    expect(calls()[2].url).toContain("ref=dev");
  });

  it("distinguishes a missing repository from a missing branch", async () => {
    queue(json({ message: "404" }, 404));
    await expect(listGitlabTree(ref, "t")).rejects.toThrow(
      /Repository group\/sub\/site was not found on GitLab/,
    );
    fetchMock.mockReset();
    queue(json({ default_branch: "main" }), json({ message: "404" }, 404));
    await expect(listGitlabTree(ref, "t", "dev")).rejects.toThrow(
      /Branch dev was not found on GitLab/,
    );
  });
});

describe("pushGitlab", () => {
  it("commits every action in one commit", async () => {
    queue(json({ commit: { id: "head1" } }), json({ id: "commit1" }));
    const result = await pushGitlab(options());
    expect(result).toEqual({ commitSha: "commit1", branch: "main", commits: 1 });

    const c = calls();
    expect(c.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(c[0].url).toBe(project + "/repository/branches/main");
    expect(c[1].url).toBe(project + "/repository/commits");
    expect(c[1].body).toEqual({
      branch: "main",
      commit_message: "Publish",
      author_name: "Ada",
      author_email: "ada@example.com",
      actions: [
        { action: "create", file_path: "src/new.ts", content: "bmV3", encoding: "base64" },
        { action: "update", file_path: "README.md", content: "aGVsbG8=", encoding: "base64" },
        { action: "delete", file_path: "old.txt" },
      ],
    });
    expect(c[0].headers["PRIVATE-TOKEN"]).toBe("glpat_secret");
    expect(c[1].headers["Content-Type"]).toBe("application/json");
    for (const call of c) expect(call.url).not.toContain("glpat_secret");
  });

  it("starts the new branch from the base commit in the same call", async () => {
    queue(json({ commit: { id: "head1" } }), json({ id: "commit1" }));
    await pushGitlab(
      options({
        branch: "feat/x",
        baseBranch: "main",
        changes: { added: [{ path: "a.txt", bytes: bytes("a") }], modified: [], deleted: [] },
      }),
    );
    const body = calls()[1].body as Record<string, unknown>;
    expect(body.branch).toBe("feat/x");
    expect(body.start_branch).toBe("main");
    expect(calls()[0].url).toBe(project + "/repository/branches/main");
  });

  it("refuses when the branch moved since the diff was computed", async () => {
    queue(json({ commit: { id: "moved" } }));
    await expect(pushGitlab(options())).rejects.toThrow(/moved while planning/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP failures to actionable messages", async () => {
    const cases: { response: Response | Error; pattern: RegExp }[] = [
      { response: json({ message: "401" }, 401), pattern: /rejected the token/ },
      { response: json({ message: "403" }, 403), pattern: /write_repository/ },
      { response: json({ message: "404" }, 404), pattern: /Branch main was not found on GitLab/ },
      { response: json({ message: "409" }, 409), pattern: /moved while planning/ },
      { response: json({ message: "422" }, 422), pattern: /moved while planning/ },
      { response: json({ message: "boom" }, 500), pattern: /GitLab request failed \(HTTP 500\)/ },
      { response: new TypeError("Failed to fetch"), pattern: /Could not reach GitLab.*CORS/ },
    ];
    for (const { response, pattern } of cases) {
      fetchMock.mockReset();
      if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
      else fetchMock.mockResolvedValueOnce(response);
      await expect(pushGitlab(options())).rejects.toThrow(pattern);
    }
  });

  it("never leaks the token into an error message", async () => {
    for (const status of [401, 403, 404, 409, 422, 500]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(json({ message: "token glpat_secret rejected" }, status));
      const error = await rejection(pushGitlab(options()));
      expect(error.message).not.toContain("glpat_secret");
    }
  });
});
