// The network half of Source Control: real git over HTTPS through the
// deployment's stateless proxy (D-079).
//
// isomorphic-git is lazy-imported by git-http.ts. Credentials arrive per call and
// only reach `onAuth` (an Authorization header) — never a URL, remote config,
// shared state, or error message.

import type { HttpClient } from "isomorphic-git";
import {
  authCallback,
  createGitHttp,
  defaultUsername,
  emptyRemoteBranch,
  guarded,
  loadGit,
  probeProxy,
  proxyBase,
  type Credentials,
  type GitApi,
  type GitHttpClient,
} from "./git-http";
import type { GitFs } from "./git-fs";

export { authCallback, defaultUsername, probeProxy, proxyBase };
export type { Credentials, GitApi };

export type ProgressReporter = (phase: string, loaded: number, total: number) => void;

/** Shown whenever the deployment compiled real git out or its proxy is down. */
export const PROXY_UNAVAILABLE_MESSAGE =
  "Git needs the same-origin proxy; this deployment does not provide one.";

const INVALID_REMOTE_MESSAGE = "Enter an https:// git URL without credentials.";
const DIVERGED_MESSAGE = "Local and remote branches diverged — resolve manually.";

type GitProgress = { phase: string; loaded: number; total: number };

interface RemoteOpsDeps {
  loadGit: () => Promise<GitApi>;
  proxyBase: () => string | null;
  probe: (base: string) => Promise<boolean>;
  httpFor: (base: string) => GitHttpClient;
}

export interface RemoteOps {
  proxyBase(): string | null;
  probe(base: string): Promise<boolean>;
  currentBranch(fs: GitFs, dir: string): Promise<string | null>;
  listRemotes(fs: GitFs, dir: string): Promise<{ remote: string; url: string }[]>;
  setRemote(fs: GitFs, dir: string, url: string, remote?: string): Promise<void>;
  cloneRepo(opts: CloneOptions): Promise<{ branch: string }>;
  fetchRepo(opts: FetchOptions): Promise<void>;
  pullRepo(opts: PullOptions): Promise<{ updated: boolean; branch: string }>;
  pushRepo(opts: PushOptions): Promise<void>;
  remoteStatus(opts: StatusOptions): Promise<{ ahead: number; behind: number }>;
}

export interface RemoteOptions {
  fs: GitFs;
  dir: string;
  url: string;
  remote?: string;
  credentials?: Credentials;
  onProgress?: ProgressReporter;
}
export type CloneOptions = Omit<RemoteOptions, "remote">;
export type FetchOptions = RemoteOptions;
export type PullOptions = RemoteOptions;
export interface PushOptions extends RemoteOptions {
  branch: string;
  credentials: Credentials;
}
export type StatusOptions = Pick<RemoteOptions, "fs" | "dir" | "url" | "remote"> & {
  branch: string;
};

// ── helpers ──

function assertProxyableRemote(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(INVALID_REMOTE_MESSAGE);
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new Error(INVALID_REMOTE_MESSAGE);
  }
}

function progressCallback(
  onProgress?: ProgressReporter,
): ((event: GitProgress) => void) | undefined {
  if (!onProgress) return undefined;
  return (event) => onProgress(event.phase, event.loaded, event.total);
}

async function logOids(git: GitApi, fs: GitFs, dir: string, ref: string): Promise<string[]> {
  try {
    const commits = await git.log({ fs, dir, ref });
    return commits.map((commit) => commit.oid);
  } catch {
    return [];
  }
}

async function remoteNameFor(
  git: GitApi,
  fs: GitFs,
  dir: string,
  url: string | undefined,
): Promise<string | null> {
  if (!url) return null;
  const remotes = await git.listRemotes({ fs, dir }).catch(() => []);
  return remotes.find((entry) => entry.url === url)?.remote ?? null;
}

export function createRemoteOps(overrides: Partial<RemoteOpsDeps> = {}): RemoteOps {
  const deps: RemoteOpsDeps = {
    loadGit,
    proxyBase,
    probe: probeProxy,
    httpFor: createGitHttp,
    ...overrides,
  };

  async function requireProxy(): Promise<string> {
    const base = deps.proxyBase();
    if (base === null || !(await deps.probe(base))) throw new Error(PROXY_UNAVAILABLE_MESSAGE);
    return base;
  }

  async function connect(url: string): Promise<{ git: GitApi; http: HttpClient }> {
    assertProxyableRemote(url);
    const base = await requireProxy();
    // The contract exposes Promise<unknown>; isomorphic-git wants its own
    // HttpClient. Only the URL is rewritten, so the shapes stay identical.
    return { git: await deps.loadGit(), http: deps.httpFor(base) as unknown as HttpClient };
  }

  return {
    proxyBase: deps.proxyBase,
    probe: deps.probe,

    async currentBranch(fs, dir) {
      const git = await deps.loadGit();
      return (await git.currentBranch({ fs, dir, fullname: false })) ?? null;
    },

    async listRemotes(fs, dir) {
      const git = await deps.loadGit();
      return git.listRemotes({ fs, dir });
    },

    async setRemote(fs, dir, url, remote = "origin") {
      // Remote config is persistent, so a credential hidden in the URL is
      // refused rather than stored.
      assertProxyableRemote(url);
      const git = await deps.loadGit();
      await git.addRemote({ fs, dir, remote, url, force: true });
    },

    async cloneRepo({ fs, dir, url, credentials, onProgress }) {
      const { git, http } = await connect(url);
      return guarded(credentials, async () => {
        // An empty repository has nothing to fetch and no HEAD to check out (D-080):
        // detect it first, init locally on the host's branch and keep the remote.
        const emptyBranch = await emptyRemoteBranch(git, http, url, credentials);
        if (emptyBranch !== null) {
          await git.init({ fs, dir, defaultBranch: emptyBranch });
          await git.addRemote({ fs, dir, remote: "origin", url });
          return { branch: emptyBranch };
        }
        await git.clone({
          fs,
          http,
          dir,
          url,
          singleBranch: false,
          onAuth: authCallback(url, credentials),
          onProgress: progressCallback(onProgress),
        });
        const branch = await git.currentBranch({ fs, dir, fullname: false });
        if (!branch) throw new Error("Clone finished without a checked-out branch.");
        return { branch };
      });
    },

    async fetchRepo({ fs, dir, url, remote = "origin", credentials, onProgress }) {
      const { git, http } = await connect(url);
      await guarded(credentials, () =>
        git.fetch({
          fs,
          http,
          dir,
          url,
          remote,
          onAuth: authCallback(url, credentials),
          onProgress: progressCallback(onProgress),
        }),
      );
    },

    async pullRepo({ fs, dir, url, remote = "origin", credentials, onProgress }) {
      const { git, http } = await connect(url);
      return guarded(credentials, async () => {
        const branch = (await git.currentBranch({ fs, dir, fullname: false })) ?? "";
        if (branch === "") throw new Error("Check out a branch before pulling.");
        // Fetch first so the tracking ref is authoritative, then fast-forward
        // only when that cannot lose a local commit.
        await git.fetch({
          fs,
          http,
          dir,
          url,
          remote,
          onAuth: authCallback(url, credentials),
          onProgress: progressCallback(onProgress),
        });
        const localOid = await git.resolveRef({ fs, dir, ref: branch });
        const remoteOid = await git.resolveRef({
          fs,
          dir,
          ref: `refs/remotes/${remote}/${branch}`,
        });
        if (localOid === remoteOid) return { updated: false, branch };
        const fastForwardable = await git.isDescendent({
          fs,
          dir,
          oid: remoteOid,
          ancestor: localOid,
        });
        if (!fastForwardable) throw new Error(DIVERGED_MESSAGE);
        // fastForward is fastForwardOnly, so even a race cannot merge a
        // diverged history or discard local commits.
        await git.fastForward({
          fs,
          http,
          dir,
          ref: branch,
          remote,
          remoteRef: branch,
          url,
          onAuth: authCallback(url, credentials),
          onProgress: progressCallback(onProgress),
        });
        return { updated: true, branch };
      });
    },

    async pushRepo({ fs, dir, url, remote = "origin", branch, credentials, onProgress }) {
      const { git, http } = await connect(url);
      await guarded(credentials, async () => {
        const localOid = await git.resolveRef({ fs, dir, ref: branch }).catch(() => null);
        if (localOid === null) throw new Error(`Branch "${branch}" does not exist locally.`);
        await git.push({
          fs,
          http,
          dir,
          url,
          remote,
          ref: branch,
          onAuth: authCallback(url, credentials),
          onProgress: progressCallback(onProgress),
        });
        // Record the upstream the way the git CLI would, so a later fetch or
        // pull knows which remote branch this one tracks.
        await git.setConfig({ fs, dir, path: `branch.${branch}.remote`, value: remote });
        await git.setConfig({
          fs,
          dir,
          path: `branch.${branch}.merge`,
          value: `refs/heads/${branch}`,
        });
      });
    },

    async remoteStatus({ fs, dir, url, branch, remote }) {
      const git = await deps.loadGit();
      const name = remote ?? (await remoteNameFor(git, fs, dir, url)) ?? "origin";
      const [local, tracking] = await Promise.all([
        logOids(git, fs, dir, branch),
        logOids(git, fs, dir, `refs/remotes/${name}/${branch}`),
      ]);
      const localSet = new Set(local);
      const trackingSet = new Set(tracking);
      return {
        ahead: local.filter((oid) => !trackingSet.has(oid)).length,
        behind: tracking.filter((oid) => !localSet.has(oid)).length,
      };
    },
  };
}

// ── public surface (the default ops, wired to the real deployment) ──

const defaultOps = createRemoteOps();

export const { cloneRepo, fetchRepo, listRemotes, pullRepo, pushRepo, remoteStatus, setRemote } =
  defaultOps;
