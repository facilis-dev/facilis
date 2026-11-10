import { describe, expect, it, vi } from "vitest";
import type { KernelBridge } from "./kernel";
import type { GitFs } from "./git-fs";
import { GitRemoteSession } from "./git-remote-session";
import {
  PROXY_UNAVAILABLE_MESSAGE,
  type CloneOptions,
  type FetchOptions,
  type PullOptions,
  type PushOptions,
  type RemoteOps,
  type StatusOptions,
} from "./git-remote";

const URL = "https://github.com/o/r.git";
const NEXT_URL = "https://github.com/o/r2.git";
const BASE = "https://app.example.com/git-proxy";
const TOKEN = "ghp_secret_token";

// createGitFs only holds the bridge until a git op runs; these ops never touch
// the VFS, so a request/post recorder is the whole surface needed.
const bridge = { post: vi.fn(), request: vi.fn() } as unknown as KernelBridge;

function makeOps() {
  return {
    proxyBase: vi.fn((): string | null => BASE),
    probe: vi.fn(async (_base: string): Promise<boolean> => true),
    currentBranch: vi.fn(async (_fs: GitFs, _dir: string): Promise<string | null> => "main"),
    listRemotes: vi.fn(async (_fs: GitFs, _dir: string) => [{ remote: "origin", url: URL }]),
    setRemote: vi.fn(async (_fs: GitFs, _dir: string, _url: string): Promise<void> => undefined),
    cloneRepo: vi.fn(async (_opts: CloneOptions) => ({ branch: "main" })),
    fetchRepo: vi.fn(async (_opts: FetchOptions): Promise<void> => undefined),
    pullRepo: vi.fn(async (_opts: PullOptions) => ({ updated: true, branch: "main" })),
    pushRepo: vi.fn(async (_opts: PushOptions): Promise<void> => undefined),
    remoteStatus: vi.fn(async (_opts: StatusOptions) => ({ ahead: 2, behind: 3 })),
  } satisfies RemoteOps;
}

function sessionWith(ops: ReturnType<typeof makeOps>) {
  return new GitRemoteSession(bridge, ops);
}

describe("GitRemoteSession.detect", () => {
  it("probes the proxy once and reads remote, branch and status", async () => {
    const ops = makeOps();
    const session = sessionWith(ops);

    await session.detect("/p");
    expect(session.getSnapshot()).toMatchObject({
      proxy: BASE,
      available: true,
      root: "/p",
      url: URL,
      branch: "main",
      ahead: 2,
      behind: 3,
      busy: false,
      phase: "",
      error: null,
    });

    // The health check is cached: a second detect does not probe again.
    await session.detect("/p");
    expect(ops.probe).toHaveBeenCalledTimes(1);
  });

  it("reports a deployment without a proxy", async () => {
    const ops = makeOps();
    ops.proxyBase.mockReturnValue(null);
    const session = sessionWith(ops);

    await session.detect("/p");
    const state = session.getSnapshot();
    expect(state.available).toBe(false);
    expect(state.proxy).toBeNull();
    expect(state.error).toBe(PROXY_UNAVAILABLE_MESSAGE);
    expect(state.busy).toBe(false);
    expect(ops.probe).not.toHaveBeenCalled();
  });

  it("reports a proxy that fails its health check", async () => {
    const ops = makeOps();
    ops.probe.mockResolvedValue(false);
    const session = sessionWith(ops);

    await session.detect("/p");
    expect(session.getSnapshot()).toMatchObject({
      proxy: BASE,
      available: false,
      error: PROXY_UNAVAILABLE_MESSAGE,
    });
  });
});

describe("GitRemoteSession.setRemote", () => {
  it("saves the remote and refreshes the readout", async () => {
    const ops = makeOps();
    let saved = URL;
    ops.listRemotes.mockImplementation(async () => [{ remote: "origin", url: saved }]);
    ops.setRemote.mockImplementation(async (_fs: GitFs, _root: string, url: string) => {
      saved = url;
    });
    const session = sessionWith(ops);

    await expect(session.setRemote("/p", NEXT_URL)).resolves.toBe(true);
    expect(ops.setRemote).toHaveBeenCalledWith(expect.anything(), "/p", NEXT_URL);
    expect(session.getSnapshot()).toMatchObject({
      root: "/p",
      url: NEXT_URL,
      branch: "main",
      busy: false,
      phase: "",
      error: null,
    });
  });

  it("returns false and records the error when the save fails", async () => {
    const ops = makeOps();
    ops.setRemote.mockRejectedValueOnce(new Error("bad remote"));
    const session = sessionWith(ops);

    await expect(session.setRemote("/p", NEXT_URL)).resolves.toBe(false);
    expect(session.getSnapshot()).toMatchObject({
      busy: false,
      phase: "",
      error: "bad remote",
    });
  });
});

describe("GitRemoteSession.fetch", () => {
  it("exposes busy/phase while the network op runs", async () => {
    const ops = makeOps();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ops.fetchRepo.mockImplementationOnce(() => gate);
    const session = sessionWith(ops);

    const pending = session.fetch("/p", { token: TOKEN });
    await vi.waitFor(() => expect(ops.fetchRepo).toHaveBeenCalled());
    expect(session.getSnapshot()).toMatchObject({ busy: true, phase: "fetch", error: null });

    release();
    await expect(pending).resolves.toBe(true);
    expect(session.getSnapshot()).toMatchObject({
      busy: false,
      phase: "",
      ahead: 2,
      behind: 3,
      error: null,
    });
  });

  it("hands credentials to the op but never into the snapshot", async () => {
    const ops = makeOps();
    const session = sessionWith(ops);

    await session.fetch("/p", { token: TOKEN });
    const call = ops.fetchRepo.mock.calls[0]?.[0];
    expect(call?.credentials?.token).toBe(TOKEN);
    expect(JSON.stringify(session.getSnapshot())).not.toContain(TOKEN);
  });

  it("returns false after setting the error when the fetch fails", async () => {
    const ops = makeOps();
    ops.fetchRepo.mockRejectedValueOnce(new Error("network down"));
    const session = sessionWith(ops);

    await expect(session.fetch("/p", { token: TOKEN })).resolves.toBe(false);
    expect(session.getSnapshot()).toMatchObject({
      busy: false,
      phase: "",
      error: "network down",
    });
    expect(JSON.stringify(session.getSnapshot())).not.toContain(TOKEN);
  });
});

describe("GitRemoteSession pull and push", () => {
  it("pull updates the branch readout", async () => {
    const ops = makeOps();
    ops.pullRepo.mockResolvedValueOnce({ updated: true, branch: "feature" });
    ops.currentBranch.mockResolvedValue("feature");
    const session = sessionWith(ops);

    await expect(session.pull("/p")).resolves.toBe(true);
    expect(ops.pullRepo).toHaveBeenCalledWith(
      expect.objectContaining({ dir: "/p", url: URL, remote: "origin" }),
    );
    expect(session.getSnapshot().branch).toBe("feature");
  });

  it("fires onWorkdirChanged only after a successful pull", async () => {
    const ops = makeOps();
    const session = sessionWith(ops);
    let fired = 0;
    session.onWorkdirChanged = () => {
      fired += 1;
    };

    await expect(session.fetch("/p")).resolves.toBe(true);
    await expect(session.push("/p", { token: TOKEN })).resolves.toBe(true);
    expect(fired).toBe(0);

    await expect(session.pull("/p")).resolves.toBe(true);
    expect(fired).toBe(1);

    ops.pullRepo.mockRejectedValueOnce(new Error("conflict"));
    await expect(session.pull("/p")).resolves.toBe(false);
    expect(fired).toBe(1);
  });

  it("push passes the branch and credentials, then returns false on rejection", async () => {
    const ops = makeOps();
    const session = sessionWith(ops);

    await expect(session.push("/p", { token: TOKEN })).resolves.toBe(true);
    expect(ops.pushRepo).toHaveBeenCalledWith(
      expect.objectContaining({ dir: "/p", branch: "main", credentials: { token: TOKEN } }),
    );

    ops.pushRepo.mockRejectedValueOnce(new Error("rejected"));
    await expect(session.push("/p", { token: TOKEN })).resolves.toBe(false);
    expect(session.getSnapshot().error).toBe("rejected");
    expect(JSON.stringify(session.getSnapshot())).not.toContain(TOKEN);
  });
});
