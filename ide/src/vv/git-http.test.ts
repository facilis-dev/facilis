import { beforeEach, describe, expect, it, vi } from "vitest";

// isomorphic-git's browser client reaches the real network; stub it with a
// recorder so the test asserts on the rewritten URL without any fetch.
const httpRequest = vi.hoisted(() =>
  vi.fn(async (_request: Record<string, unknown>) => ({ statusCode: 200 })),
);
vi.mock("isomorphic-git/http/web", () => ({ default: { request: httpRequest } }));

import {
  branchForEmptyRemote,
  createGitHttp,
  emptyRemoteBranch,
  isProxyAuthRequired,
  proxyUrlFor,
  resolveProxyBase,
} from "./git-http";

beforeEach(() => {
  httpRequest.mockClear();
});

describe("resolveProxyBase", () => {
  it("puts a same-origin proxy on the page origin", () => {
    expect(resolveProxyBase("same-origin", "https://app.example.com")).toBe(
      "https://app.example.com/git-proxy",
    );
    expect(resolveProxyBase("same-origin", "https://app.example.com/")).toBe(
      "https://app.example.com/git-proxy",
    );
  });

  it("uses an absolute https proxy URL, trimmed of its trailing slash", () => {
    expect(resolveProxyBase("https://proxy.example.com/git", "https://app.example.com")).toBe(
      "https://proxy.example.com/git",
    );
    expect(resolveProxyBase("https://proxy.example.com/git/", "https://app.example.com")).toBe(
      "https://proxy.example.com/git",
    );
  });

  it("returns null when git is compiled out or the value is unusable", () => {
    expect(resolveProxyBase(null, "https://app.example.com")).toBeNull();
    expect(resolveProxyBase("", "https://app.example.com")).toBeNull();
    expect(resolveProxyBase("   ", "https://app.example.com")).toBeNull();
    expect(resolveProxyBase("not a url", "https://app.example.com")).toBeNull();
    expect(resolveProxyBase("http://proxy.example.com", "https://app.example.com")).toBeNull();
    expect(resolveProxyBase("https://proxy.example.com", "")).not.toBeNull();
    expect(resolveProxyBase("same-origin", "")).toBeNull();
  });
});

describe("proxyUrlFor", () => {
  const base = "https://app.example.com/git-proxy";

  it("prefixes the remote host and keeps the path", () => {
    expect(proxyUrlFor(base, "https://github.com/o/r.git")).toBe(
      "https://app.example.com/git-proxy/github.com/o/r.git",
    );
  });

  it("preserves the query string git's handshake uses", () => {
    expect(proxyUrlFor(base, "https://github.com/o/r.git?service=git-upload-pack&x=1")).toBe(
      "https://app.example.com/git-proxy/github.com/o/r.git?service=git-upload-pack&x=1",
    );
  });

  it("keeps a self-hosted port", () => {
    expect(proxyUrlFor(base, "https://gitea.local:3000/o/r.git")).toBe(
      "https://app.example.com/git-proxy/gitea.local:3000/o/r.git",
    );
  });

  it("refuses non-https and unparseable remotes", () => {
    expect(proxyUrlFor(base, "http://github.com/o/r.git")).toBeNull();
    expect(proxyUrlFor(base, "git@github.com:o/r.git")).toBeNull();
    expect(proxyUrlFor(base, "garbage")).toBeNull();
    expect(proxyUrlFor(base, "https://github.com/o/r.git")).not.toContain("token");
  });

  it("refuses a remote that hides credentials in its userinfo", () => {
    expect(proxyUrlFor(base, "https://user:token@github.com/o/r.git")).toBeNull();
  });
});

describe("createGitHttp", () => {
  it("rewrites only the URL and forwards headers", async () => {
    const client = createGitHttp("https://app.example.com/git-proxy/");
    await client.request({
      url: "https://github.com/o/r.git/info/refs?service=git-upload-pack",
      method: "GET",
      headers: { Authorization: "Bearer secret-token" },
    });

    expect(httpRequest).toHaveBeenCalledTimes(1);
    const sent = httpRequest.mock.calls[0]?.[0] as unknown as {
      url: string;
      method: string;
      headers: Record<string, string>;
    };
    expect(sent.url).toBe(
      "https://app.example.com/git-proxy/github.com/o/r.git/info/refs?service=git-upload-pack",
    );
    expect(sent.method).toBe("GET");
    expect(sent.headers.Authorization).toBe("Bearer secret-token");
    expect(sent.url).not.toContain("secret-token");
  });

  it("rejects a remote it cannot proxy without echoing the input", async () => {
    const client = createGitHttp("https://app.example.com/git-proxy");
    await expect(client.request({ url: "http://github.com/o/r.git" })).rejects.toThrow(
      "Git remote URL must be an https:// URL without credentials.",
    );
    const err = await client.request({ url: "https://u:tok@github.com/o/r.git" }).catch((e) => e);
    expect(String(err)).not.toContain("tok");
  });
});

describe("empty remotes (D-080)", () => {
  const gitWith = (refs: Record<string, string>, HEAD?: string) =>
    ({
      getRemoteInfo: async () => ({ refs, HEAD }),
    }) as unknown as Parameters<typeof emptyRemoteBranch>[0];

  it("reads the branch an empty remote advertises", async () => {
    expect(branchForEmptyRemote("refs/heads/trunk")).toBe("trunk");
    expect(branchForEmptyRemote(undefined)).toBe("main");
    expect(branchForEmptyRemote("HEAD")).toBe("main");
  });

  it("returns the default branch only when the remote has no refs", async () => {
    const empty = await emptyRemoteBranch(
      gitWith({}, "refs/heads/main"),
      {} as Parameters<typeof emptyRemoteBranch>[1],
      "https://github.com/o/r.git",
    );
    expect(empty).toBe("main");
    const populated = await emptyRemoteBranch(
      gitWith({ "refs/heads/main": "abc" }),
      {} as Parameters<typeof emptyRemoteBranch>[1],
      "https://github.com/o/r.git",
    );
    expect(populated).toBeNull();
  });
});

function httpError(statusCode: number, response: string): Error {
  return Object.assign(new Error(`HTTP Error: ${statusCode}`), {
    code: "HttpError",
    data: { statusCode, statusMessage: "", response },
  });
}

describe("isProxyAuthRequired", () => {
  it("matches the proxy's 401 body, also through guarded's wrapper", () => {
    const raw = httpError(401, "authorization required");
    expect(isProxyAuthRequired(raw)).toBe(true);
    expect(isProxyAuthRequired(new Error("HTTP Error: 401 Unauthorized", { cause: raw }))).toBe(
      true,
    );
  });

  it("does not match a host's own 401, other statuses, or non-errors", () => {
    expect(isProxyAuthRequired(httpError(401, "Bad credentials"))).toBe(false);
    expect(isProxyAuthRequired(httpError(403, "authorization required"))).toBe(false);
    expect(isProxyAuthRequired(new Error("HTTP Error: 401 Unauthorized"))).toBe(false);
    expect(isProxyAuthRequired(null)).toBe(false);
    expect(isProxyAuthRequired("authorization required")).toBe(false);
  });
});
