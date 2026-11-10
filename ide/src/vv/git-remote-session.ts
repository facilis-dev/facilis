// The SCM panel's remote store: real git over HTTPS for one repository.
//
// Mirrors DebugSession / StatusMessage: an immutable snapshot read through
// useSyncExternalStore. The class owns the kernel-backed GitFs and a RemoteOps;
// credentials are per-call arguments and are never copied into the snapshot.
// Every operation turns a failure into `error` (and returns false) instead of
// throwing at the UI.

import type { KernelBridge } from "./kernel";
import { createGitFs, type GitFs } from "./git-fs";
import {
  createRemoteOps,
  PROXY_UNAVAILABLE_MESSAGE,
  type Credentials,
  type RemoteOps,
} from "./git-remote";

export interface GitRemoteState {
  proxy: string | null;
  available: boolean;
  root: string | null;
  url: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  busy: boolean;
  phase: string;
  error: string | null;
}

const IDLE = "";

function emptyState(): GitRemoteState {
  return {
    proxy: null,
    available: false,
    root: null,
    url: null,
    branch: null,
    ahead: 0,
    behind: 0,
    busy: false,
    phase: IDLE,
    error: null,
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface RemoteRef {
  remote: string;
  url: string;
}

export class GitRemoteSession {
  private readonly fs: GitFs;
  private readonly ops: RemoteOps;
  private listeners = new Set<() => void>();
  private snap: GitRemoteState = emptyState();
  // The deployment's proxy is fixed for the life of the page, so the health
  // probe runs once; every later detect reuses this promise.
  private proxyReady: Promise<string | null> | null = null;
  /**
   * Fired after a pull rewrote the working tree (fetch/push leave file bytes alone), so the
   * controller can refresh the Explorer and reload the open editor buffers.
   */
  onWorkdirChanged: (() => void) | null = null;

  constructor(bridge: KernelBridge, ops: RemoteOps = createRemoteOps()) {
    this.fs = createGitFs(bridge);
    this.ops = ops;
  }

  // ── store plumbing ──

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getSnapshot = (): GitRemoteState => this.snap;

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private patch(patch: Partial<GitRemoteState>) {
    this.snap = { ...this.snap, ...patch };
    this.emit();
  }

  // ── proxy ──

  private async ensureProxy(): Promise<string | null> {
    const base = this.ops.proxyBase();
    if (!this.proxyReady) {
      this.proxyReady =
        base === null
          ? Promise.resolve(null)
          : this.ops.probe(base).then((ok) => (ok ? base : null));
    }
    const ready = await this.proxyReady;
    this.patch({ proxy: base, available: ready !== null });
    return ready;
  }

  // ── helpers ──

  private async currentRemote(root: string): Promise<RemoteRef | null> {
    const remotes = await this.ops.listRemotes(this.fs, root);
    return remotes.find((entry) => entry.remote === "origin") ?? remotes[0] ?? null;
  }

  private async requireRemote(root: string): Promise<RemoteRef> {
    const base = await this.ensureProxy();
    if (base === null) throw new Error(PROXY_UNAVAILABLE_MESSAGE);
    const remote = await this.currentRemote(root);
    if (remote === null) throw new Error("No git remote is configured.");
    return remote;
  }

  private async refreshRemote(root: string, remote: RemoteRef): Promise<void> {
    const branch = await this.ops.currentBranch(this.fs, root);
    if (branch === null) {
      this.patch({ url: remote.url, branch: null, ahead: 0, behind: 0 });
      return;
    }
    const status = await this.ops.remoteStatus({
      fs: this.fs,
      dir: root,
      url: remote.url,
      branch,
      remote: remote.remote,
    });
    this.patch({ url: remote.url, branch, ahead: status.ahead, behind: status.behind });
  }

  /** Run one operation with busy/phase/error set; never throws at the caller. */
  private async run<T>(phase: string, fn: () => Promise<T>): Promise<T | null> {
    if (this.snap.busy) return null;
    this.patch({ busy: true, phase, error: null });
    try {
      return await fn();
    } catch (err) {
      this.patch({ error: errorText(err) });
      return null;
    } finally {
      this.patch({ busy: false, phase: IDLE });
    }
  }

  // ── operations ──

  /** Probe once, then read the remote, the branch and the ahead/behind counts. */
  async detect(root: string): Promise<void> {
    await this.run("detect", async () => {
      this.patch({ root });
      const base = await this.ensureProxy();
      if (base === null) {
        this.patch({ url: null, branch: null, ahead: 0, behind: 0 });
        throw new Error(PROXY_UNAVAILABLE_MESSAGE);
      }
      const remote = await this.currentRemote(root);
      const branch = await this.ops.currentBranch(this.fs, root);
      if (remote === null || branch === null) {
        this.patch({ url: remote?.url ?? null, branch, ahead: 0, behind: 0 });
        return;
      }
      const status = await this.ops.remoteStatus({
        fs: this.fs,
        dir: root,
        url: remote.url,
        branch,
        remote: remote.remote,
      });
      this.patch({
        url: remote.url,
        branch,
        ahead: status.ahead,
        behind: status.behind,
      });
    });
  }

  async setRemote(root: string, url: string): Promise<boolean> {
    const result = await this.run("set-remote", async () => {
      this.patch({ root });
      const base = await this.ensureProxy();
      if (base === null) throw new Error(PROXY_UNAVAILABLE_MESSAGE);
      await this.ops.setRemote(this.fs, root, url);
      const remote = await this.currentRemote(root);
      if (remote === null) throw new Error("The remote could not be saved.");
      await this.refreshRemote(root, remote);
      return true;
    });
    return result === true;
  }

  async fetch(root: string, credentials?: Credentials): Promise<boolean> {
    const result = await this.run("fetch", async () => {
      this.patch({ root });
      const remote = await this.requireRemote(root);
      await this.ops.fetchRepo({
        fs: this.fs,
        dir: root,
        url: remote.url,
        remote: remote.remote,
        credentials,
      });
      await this.refreshRemote(root, remote);
      return true;
    });
    return result === true;
  }

  async pull(root: string, credentials?: Credentials): Promise<boolean> {
    const result = await this.run("pull", async () => {
      this.patch({ root });
      const remote = await this.requireRemote(root);
      const pulled = await this.ops.pullRepo({
        fs: this.fs,
        dir: root,
        url: remote.url,
        remote: remote.remote,
        credentials,
      });
      this.patch({ branch: pulled.branch });
      await this.refreshRemote(root, remote);
      return true;
    });
    if (result === true) this.onWorkdirChanged?.();
    return result === true;
  }

  async push(root: string, credentials: Credentials): Promise<boolean> {
    const result = await this.run("push", async () => {
      this.patch({ root });
      const remote = await this.requireRemote(root);
      const cached = this.snap.root === root ? this.snap.branch : null;
      const branch = cached ?? (await this.ops.currentBranch(this.fs, root));
      if (branch === null) throw new Error("Check out a branch before pushing.");
      await this.ops.pushRepo({
        fs: this.fs,
        dir: root,
        url: remote.url,
        remote: remote.remote,
        branch,
        credentials,
      });
      await this.refreshRemote(root, remote);
      return true;
    });
    return result === true;
  }
}
