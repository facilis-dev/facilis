import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGitRepo } from "./git-import";
import type { GitRepoRef } from "./git-provider";

interface Call {
  url: string;
  headers: Record<string, string>;
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function bytes(body: string): Response {
  return new Response(new TextEncoder().encode(body));
}

function stubFetch(routes: (url: string) => Response | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const response = routes(url);
    if (response === undefined) throw new Error("unexpected fetch " + url);
    return response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const github: GitRepoRef = {
  provider: "github",
  api: "https://api.github.com",
  owner: "owner",
  repo: "repo",
};
const gitlab: GitRepoRef = {
  provider: "gitlab",
  api: "https://gitlab.com/api/v4",
  owner: "group/sub",
  repo: "repo",
};
const gitea: GitRepoRef = {
  provider: "gitea",
  api: "https://gitea.example.com/api/v1",
  owner: "owner",
  repo: "repo",
};

describe("git import authentication", () => {
  it("reads a public GitHub repository from the raw host, without a token", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/repos/owner/repo")) return json({ default_branch: "main" });
      if (url.includes("/git/trees/"))
        return json({ tree: [{ type: "blob", path: "a.txt", size: 3 }] });
      if (url.startsWith("https://raw.githubusercontent.com/")) return bytes("hi");
      return undefined;
    });
    const tree = await fetchGitRepo(github);
    expect(tree.files.map((file) => file.path)).toEqual(["a.txt"]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBeUndefined();
      expect(call.url).not.toContain("/contents/");
    }
  });

  it("reads a private GitHub repository through the contents API", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/repos/owner/repo")) return json({ default_branch: "main" });
      if (url.includes("/git/trees/"))
        return json({ tree: [{ type: "blob", path: "a.txt", size: 3 }] });
      if (url.includes("/contents/a.txt")) return bytes("hi");
      return undefined;
    });
    const tree = await fetchGitRepo(github, { token: "tok" });
    expect(tree.files.map((file) => file.path)).toEqual(["a.txt"]);
    for (const call of calls) expect(call.headers.Authorization).toBe("Bearer tok");
    const download = calls.find((call) => call.url.includes("/contents/"));
    expect(download?.url).toContain("https://api.github.com/repos/owner/repo/contents/a.txt");
    expect(download?.headers.Accept).toBe("application/vnd.github.raw");
    expect(calls.some((call) => call.url.includes("raw.githubusercontent.com"))).toBe(false);
  });

  it("reads GitLab through its API with PRIVATE-TOKEN", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/projects/group%2Fsub%2Frepo")) return json({ default_branch: "main" });
      if (url.includes("/repository/tree?"))
        return json([
          { type: "tree", path: "src" },
          { type: "blob", path: "src/a.txt" },
        ]);
      if (url.includes("/repository/files/src%2Fa.txt/raw")) return bytes("hi");
      return undefined;
    });
    const tree = await fetchGitRepo(gitlab, { token: "glpat" });
    expect(tree.files.map((file) => file.path)).toEqual(["src/a.txt"]);
    const download = calls.find((call) => call.url.includes("/files/"));
    expect(download?.url).toContain("/repository/files/src%2Fa.txt/raw?ref=main");
    for (const call of calls) expect(call.headers["PRIVATE-TOKEN"]).toBe("glpat");
  });

  it("reads Gitea/Forgejo through its API with a token scheme", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/repos/owner/repo")) return json({ default_branch: "main" });
      if (url.includes("/git/trees/main?") && url.includes("page=2")) return json({ tree: [] });
      if (url.includes("/git/trees/main?"))
        return json({ tree: [{ type: "blob", path: "a.txt", size: 3 }] });
      if (url.includes("/raw/a.txt?")) return bytes("hi");
      return undefined;
    });
    const tree = await fetchGitRepo(gitea, { token: "tok" });
    expect(tree.files.map((file) => file.path)).toEqual(["a.txt"]);
    for (const call of calls) expect(call.headers.Authorization).toBe("token tok");
    expect(calls.some((call) => call.url.includes("/raw/a.txt?ref=main"))).toBe(true);
  });
});
