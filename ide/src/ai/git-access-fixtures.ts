// Fake GitPorts for the git tool tests: no controller, no kernel, no browser.

import type { GitChange, RepoState } from "@/vv/scm-session";
import type { GitRemoteState } from "@/vv/git-remote-session";
import type { GitPorts } from "./git-access";
import type { RepoContents, RepoRemote } from "./git-repo";

export const ROOT = "/w/app";
export type Json = Record<string, unknown>;

export function change(path: string, letter: GitChange["letter"] = "M"): GitChange {
  return { path, abs: ROOT + "/" + path, letter };
}

export function repoState(overrides: Partial<RepoState> = {}): RepoState {
  return {
    root: ROOT,
    name: "app",
    isRepo: true,
    checking: false,
    busy: false,
    currentBranch: "main",
    branches: ["main"],
    staged: [],
    changes: [],
    history: [],
    commitMessage: "",
    error: null,
    ...overrides,
  };
}

export interface FakeOptions {
  root?: string | null;
  repo?: Partial<RepoState> | null;
  remotes?: RepoRemote[];
  contents?: Partial<RepoContents>;
  token?: string | null;
  remote?: Partial<GitRemoteState>;
  commitOk?: boolean;
  pushOk?: boolean;
  fetchApi?: GitPorts["fetchApi"];
}

export function fakePorts(options: FakeOptions = {}) {
  const calls: string[] = [];
  const state = options.repo === null ? null : repoState(options.repo ?? {});
  const root = options.root === undefined ? ROOT : options.root;
  const remoteState: GitRemoteState = {
    proxy: "same-origin",
    available: true,
    root: ROOT,
    url: "https://github.com/acme/app.git",
    branch: "main",
    ahead: 1,
    behind: 2,
    busy: false,
    phase: "",
    error: null,
    ...options.remote,
  };
  const contents: RepoContents = {
    head: async (_root, paths) => new Map(paths.map((path) => [path, "one\ntwo\n"])),
    index: async (_root, paths) => new Map(paths.map((path) => [path, "one\nTWO\n"])),
    workdir: async (_root, paths) => new Map(paths.map((path) => [path, "one\nTWO\nthree\n"])),
    log: async () => [
      {
        oid: "0123456789abcdef0123456789abcdef01234567",
        message: "first line",
        author: "Ann",
        timestamp: 1_700_000_000,
      },
    ],
    remotes: async () =>
      options.remotes ?? [{ remote: "origin", url: "https://github.com/acme/app.git" }],
    ...options.contents,
  };
  const ports: GitPorts = {
    root: () => root,
    repo: () => state ?? undefined,
    refresh: async () => {
      calls.push("refresh");
    },
    stage: async (_root, item) => {
      calls.push("stage:" + item.path);
      state?.staged.push(item);
    },
    unstage: async (_root, item) => {
      calls.push("unstage:" + item.path);
    },
    unstageAll: async () => {
      calls.push("unstageAll");
    },
    commit: async (_root, message) => {
      calls.push("commit:" + message);
      if (options.commitOk !== false) return true;
      if (state !== null) state.error = "Set your git name and email first.";
      return false;
    },
    createBranch: async (_root, name) => {
      calls.push("createBranch:" + name);
      if (state !== null) {
        state.branches.push(name);
        state.currentBranch = name;
      }
    },
    checkoutBranch: async (_root, name) => {
      calls.push("checkoutBranch:" + name);
      if (state !== null) state.currentBranch = name;
    },
    remote: () => remoteState,
    detectRemote: async () => {
      calls.push("detectRemote");
    },
    fetch: async () => {
      calls.push("fetch");
      return true;
    },
    pull: async () => {
      calls.push("pull");
      return true;
    },
    push: async (_root, credentials) => {
      calls.push("push:" + credentials.token);
      return options.pushOk !== false;
    },
    contents,
    token: () => (options.token === undefined ? "gh-token" : options.token),
    fetchApi: options.fetchApi ?? (async () => new Response(null, { status: 500 })),
  };
  return { ports, calls, state };
}

export async function viewOf(promise: Promise<unknown>): Promise<Json> {
  return (await promise) as Json;
}
