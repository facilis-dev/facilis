import { describe, expect, it, vi } from "vitest";
import type { AuthCallback } from "isomorphic-git";
import type { GitFs } from "./git-fs";
import {
  authCallback,
  createRemoteOps,
  defaultUsername,
  PROXY_UNAVAILABLE_MESSAGE,
  type Credentials,
  type GitApi,
  type RemoteOps,
} from "./git-remote";

const URL = "https://github.com/o/r.git";
const TOKEN = "ghp_secret_token";
const BASE = "https://app.example.com/git-proxy";

// No VFS is involved: the fake git api ignores every fs it is handed.
const fs = {} as unknown as GitFs;
const httpStub = { request: vi.fn(async () => ({ statusCode: 200 })) };

interface FakeGit {
  clone: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
  fastForward: ReturnType<typeof vi.fn>;
  isDescendent: ReturnType<typeof vi.fn>;
  resolveRef: ReturnType<typeof vi.fn>;
  currentBranch: ReturnType<typeof vi.fn>;
  listRemotes: ReturnType<typeof vi.fn>;
  addRemote: ReturnType<typeof vi.fn>;
  setConfig: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

function makeGit(overrides: Partial<FakeGit> = {}): FakeGit {
  return {
    clone: vi.fn(async () => undefined),
    fetch: vi.fn(async () => undefined),
    push: vi.fn(async () => ({ ok: true })),
    fastForward: vi.fn(async () => undefined),
    isDescendent: vi.fn(async () => true),
    resolveRef: vi.fn(async ({ ref }: { ref: string }) => {
      if (ref === "main") return "local1";
      if (ref === "refs/remotes/origin/main") return "remote1";
      throw new Error("unknown ref " + ref);
    }),
    currentBranch: vi.fn(async () => "main"),
    listRemotes: vi.fn(async () => [{ remote: "origin", url: URL }]),
    addRemote: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
    log: vi.fn(async () => []),
    ...overrides,
  };
}

function makeOps(
  git: FakeGit,
  overrides: { proxyBase?: () => string | null; probe?: () => Promise<boolean> } = {},
): RemoteOps {
  return createRemoteOps({
    loadGit: async () => git as unknown as GitApi,
    proxyBase: overrides.proxyBase ?? (() => BASE),
    probe: overrides.probe ?? (async () => true),
    httpFor: () => httpStub,
  });
}

function firstArg<T>(fn: ReturnType<typeof vi.fn>): T {
  return fn.mock.calls[0]?.[0] as T;
}

const credentials = (): Credentials => ({ token: TOKEN });

describe("host usernames", () => {
  it("uses the token-as-password username each host documents", () => {
    expect(defaultUsername("github.com")).toBe("x-access-token");
    expect(defaultUsername("gitlab.com")).toBe("oauth2");
    expect(defaultUsername("gitea.com")).toBe("git");
    expect(defaultUsername("forgejo.company.com")).toBe("git");
    expect(defaultUsername("git.company.com")).toBe("git");
  });

  it("honours an explicit username and refuses to send it to another host", () => {
    const callback = authCallback(URL, { token: TOKEN, username: "alice" });
    expect(callback?.(URL, {})).toEqual({ username: "alice", password: TOKEN });
    // A redirect to a different host must not receive the credential.
    expect(callback?.("https://evil.example.com/o/r.git", {})).toBeUndefined();
  });
});

describe("cloneRepo", () => {
  it("clones with the proxy client and token auth, never a token in the URL", async () => {
    const git = makeGit();
    const ops = makeOps(git);
    const result = await ops.cloneRepo({ fs, dir: "/p", url: URL, credentials: credentials() });

    expect(result).toEqual({ branch: "main" });
    const args = firstArg<{
      url: string;
      singleBranch: boolean;
      http: unknown;
      onAuth: AuthCallback;
    }>(git.clone);
    expect(args.url).toBe(URL);
    expect(args.url).not.toContain(TOKEN);
    expect(args.singleBranch).toBe(false);
    expect(args.http).toBe(httpStub);
    expect(args.onAuth(URL, {})).toEqual({ username: "x-access-token", password: TOKEN });
    expect(JSON.stringify(git.clone.mock.calls)).not.toContain(TOKEN);
  });

  it("uses the host-specific default username", async () => {
    const git = makeGit();
    const ops = makeOps(git);
    await ops.cloneRepo({
      fs,
      dir: "/p",
      url: "https://gitlab.com/o/r.git",
      credentials: credentials(),
    });
    const args = firstArg<{ onAuth: AuthCallback }>(git.clone);
    expect(args.onAuth("https://gitlab.com/o/r.git", {})).toEqual({
      username: "oauth2",
      password: TOKEN,
    });

    const gitea = makeGit();
    await makeOps(gitea).cloneRepo({
      fs,
      dir: "/p",
      url: "https://gitea.com/o/r.git",
      credentials: { token: TOKEN, username: "someone" },
    });
    const giteaArgs = firstArg<{ onAuth: AuthCallback }>(gitea.clone);
    expect(giteaArgs.onAuth("https://gitea.com/o/r.git", {})).toEqual({
      username: "someone",
      password: TOKEN,
    });
  });

  it("reports a dead proxy before touching the network", async () => {
    const git = makeGit();
    await expect(
      makeOps(git, { proxyBase: () => null }).cloneRepo({ fs, dir: "/p", url: URL }),
    ).rejects.toThrow(PROXY_UNAVAILABLE_MESSAGE);
    await expect(
      makeOps(git, { probe: async () => false }).cloneRepo({ fs, dir: "/p", url: URL }),
    ).rejects.toThrow(PROXY_UNAVAILABLE_MESSAGE);
    expect(git.clone).not.toHaveBeenCalled();
  });
});

describe("pushRepo", () => {
  it("pushes the local branch and records its upstream", async () => {
    const git = makeGit();
    const ops = makeOps(git);
    await ops.pushRepo({
      fs,
      dir: "/p",
      url: URL,
      branch: "main",
      credentials: credentials(),
    });

    const args = firstArg<{ remote: string; ref: string; onAuth: AuthCallback }>(git.push);
    expect(args.remote).toBe("origin");
    expect(args.ref).toBe("main");
    expect(args.onAuth(URL, {})).toEqual({ username: "x-access-token", password: TOKEN });
    expect(git.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ path: "branch.main.remote", value: "origin" }),
    );
    expect(git.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ path: "branch.main.merge", value: "refs/heads/main" }),
    );
  });

  it("surfaces the host's rejection without the token", async () => {
    const git = makeGit();
    git.push.mockRejectedValueOnce(new Error("non-fast-forward: " + TOKEN));
    const err = await makeOps(git)
      .pushRepo({ fs, dir: "/p", url: URL, branch: "main", credentials: credentials() })
      .then(
        () => {
          throw new Error("expected push to reject");
        },
        (e: unknown) => e as Error,
      );
    expect(err.message).toContain("non-fast-forward");
    expect(err.message).not.toContain(TOKEN);
  });

  it("refuses a branch that does not exist locally", async () => {
    const git = makeGit({
      resolveRef: vi.fn(async () => {
        throw new Error("not found");
      }),
    });
    await expect(
      makeOps(git).pushRepo({
        fs,
        dir: "/p",
        url: URL,
        branch: "ghost",
        credentials: credentials(),
      }),
    ).rejects.toThrow('Branch "ghost" does not exist locally.');
    expect(git.push).not.toHaveBeenCalled();
  });
});

describe("pullRepo", () => {
  it("fast-forwards only when the remote is a descendant", async () => {
    const git = makeGit();
    const result = await makeOps(git).pullRepo({
      fs,
      dir: "/p",
      url: URL,
      credentials: credentials(),
    });
    expect(result).toEqual({ updated: true, branch: "main" });
    expect(git.fetch).toHaveBeenCalledTimes(1);
    expect(git.isDescendent).toHaveBeenCalledWith(
      expect.objectContaining({ oid: "remote1", ancestor: "local1" }),
    );
    const args = firstArg<{ ref: string; remote: string }>(git.fastForward);
    expect(args.ref).toBe("main");
    expect(args.remote).toBe("origin");
  });

  it("throws on divergence and leaves the tree untouched", async () => {
    const git = makeGit({ isDescendent: vi.fn(async () => false) });
    await expect(
      makeOps(git).pullRepo({ fs, dir: "/p", url: URL, credentials: credentials() }),
    ).rejects.toThrow("Local and remote branches diverged — resolve manually.");
    expect(git.fastForward).not.toHaveBeenCalled();
  });

  it("reports no change when the branch is already current", async () => {
    const git = makeGit({ resolveRef: vi.fn(async () => "same") });
    const result = await makeOps(git).pullRepo({ fs, dir: "/p", url: URL });
    expect(result).toEqual({ updated: false, branch: "main" });
    expect(git.isDescendent).not.toHaveBeenCalled();
    expect(git.fastForward).not.toHaveBeenCalled();
  });
});

describe("remoteStatus", () => {
  it("counts commits ahead and behind from the local log", async () => {
    const git = makeGit({
      log: vi.fn(async ({ ref }: { ref: string }) => {
        if (ref === "main") return [{ oid: "a" }, { oid: "b" }];
        if (ref === "refs/remotes/origin/main") return [{ oid: "b" }, { oid: "c" }];
        throw new Error("unknown ref");
      }),
    });
    const status = await makeOps(git).remoteStatus({ fs, dir: "/p", url: URL, branch: "main" });
    expect(status).toEqual({ ahead: 1, behind: 1 });
    expect(git.fetch).not.toHaveBeenCalled();
  });
});

describe("setRemote", () => {
  it("stores an https remote", async () => {
    const git = makeGit();
    await makeOps(git).setRemote(fs, "/p", URL);
    expect(git.addRemote).toHaveBeenCalledWith(
      expect.objectContaining({ remote: "origin", url: URL, force: true }),
    );
  });

  it("refuses a remote URL that carries a credential", async () => {
    const git = makeGit();
    await expect(
      makeOps(git).setRemote(fs, "/p", "https://user:" + TOKEN + "@github.com/o/r.git"),
    ).rejects.toThrow("Enter an https:// git URL without credentials.");
    expect(git.addRemote).not.toHaveBeenCalled();
  });
});
