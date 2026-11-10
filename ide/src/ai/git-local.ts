// The local half of the git tool family (D-139): repository reads and index/history/ref
// operations. The remote half (fetch/pull/push and pull requests) is git-sync.ts.
//
// Everything here is local-only and writes no project source: status/diff/log/branches/remote
// read, stage/unstage move the index, commit writes history, branch creates or checks out a ref.
// The refusals that keep it safe (dirty tree on switch, nothing staged on commit) are returned
// as data, and no argument names a credential.

import { parseGitRepo } from "@/vv/git-provider";
import type { GitAccess, GitPorts } from "./git-access";
import {
  DEFAULT_LOG,
  MAX_DIFF_CHARS,
  MAX_DIFF_FILES,
  MAX_LOG,
  changesJson,
  failed,
  hasChanges,
  missingPaths,
  originOf,
  providerOf,
  ready,
  renderFile,
} from "./git-common";
import type { RepoRemote } from "./git-repo";
import type { PtcJson } from "./ptc/protocol";

type LocalTool =
  "status" | "diff" | "log" | "branches" | "remote" | "stage" | "unstage" | "commit" | "branch";

/** The one tool that needs the proxy/remote snapshot instead of only the repository. */
async function remoteFacts(ports: GitPorts, root: string, remote: RepoRemote): Promise<PtcJson> {
  await ports.detectRemote(root);
  const state = ports.remote();
  return {
    name: remote.remote,
    url: remote.url,
    branch: state.branch,
    ahead: state.ahead,
    behind: state.behind,
    available: state.available,
    ...(state.error === null ? {} : { error: state.error }),
  };
}

export function createGitLocalOperations(ports: GitPorts): Pick<GitAccess, LocalTool> {
  return {
    async status() {
      const state = await ready(ports, true);
      if ("declined" in state) return state.declined;
      const remote = await originOf(ports, state.root);
      return {
        branch: state.repo.currentBranch,
        staged: changesJson(state.repo.staged),
        changes: changesJson(state.repo.changes),
        ...(remote === null ? {} : { remote: await remoteFacts(ports, state.root, remote) }),
        busy: state.repo.busy,
      };
    },

    async diff(request) {
      const state = await ready(ports, true);
      if ("declined" in state) return state.declined;
      const scope = request.staged ? state.repo.staged : state.repo.changes;
      const selected =
        request.path === undefined ? scope : scope.filter((change) => change.path === request.path);
      if (selected.length === 0) {
        const where = request.staged ? "staged" : "unstaged";
        return {
          diff: "",
          files: [],
          truncated: false,
          note:
            request.path === undefined
              ? "there is no " + where + " change"
              : "this path has no " + where + " change: call git_status to list the changed paths",
        };
      }
      const paths = selected.slice(0, MAX_DIFF_FILES).map((change) => change.path);
      // staged = HEAD vs index; unstaged = index vs working tree (D-139 diff semantics).
      const before = request.staged
        ? await ports.contents.head(state.root, paths)
        : await ports.contents.index(state.root, paths);
      const after = request.staged
        ? await ports.contents.index(state.root, paths)
        : await ports.contents.workdir(state.root, paths);
      const chunks: string[] = [];
      const files: PtcJson[] = [];
      let used = 0;
      let truncated = selected.length > paths.length;
      for (const path of paths) {
        const rendered = renderFile(path, before.get(path) ?? null, after.get(path) ?? null);
        if (rendered === null) {
          files.push({ path, binary: true });
          continue;
        }
        if (rendered.text.length === 0) continue;
        if (used + rendered.text.length + 1 > MAX_DIFF_CHARS) {
          truncated = true;
          break;
        }
        used += rendered.text.length + 1;
        chunks.push(rendered.text);
        files.push({
          path,
          added: rendered.added,
          removed: rendered.removed,
          ...(rendered.truncated ? { truncated: true } : {}),
        });
      }
      let text = chunks.join("\n");
      if (text.length > MAX_DIFF_CHARS) {
        text = text.slice(0, MAX_DIFF_CHARS);
        truncated = true;
      }
      return { diff: text, files, truncated };
    },

    async log(limit) {
      const state = await ready(ports, false);
      if ("declined" in state) return state.declined;
      const window = Math.min(limit ?? DEFAULT_LOG, MAX_LOG);
      const commits = await ports.contents.log(state.root, window);
      return {
        branch: state.repo.currentBranch,
        commits: commits.map((commit) => ({
          oid: commit.oid,
          short: commit.oid.slice(0, 7),
          message: commit.message,
          author: commit.author,
          timestamp: new Date(commit.timestamp * 1000).toISOString(),
        })),
        ...(commits.length === 0 ? { note: "no commits yet: the repository has no history" } : {}),
      };
    },

    async branches() {
      const state = await ready(ports, true);
      if ("declined" in state) return state.declined;
      return {
        current: state.repo.currentBranch,
        branches: state.repo.branches,
        detached: state.repo.currentBranch === null,
      };
    },

    async remote() {
      const state = await ready(ports, false);
      if ("declined" in state) return state.declined;
      const remote = await originOf(ports, state.root);
      await ports.detectRemote(state.root);
      const snapshot = ports.remote();
      const provider = providerOf(remote?.url ?? null);
      const ref = remote === null ? null : parseGitRepo(remote.url, provider ?? "github");
      return {
        branch: snapshot.branch ?? state.repo.currentBranch,
        remote: remote === null ? null : { name: remote.remote, url: remote.url },
        provider: ref?.provider ?? provider,
        owner: ref?.owner ?? null,
        repo: ref?.repo ?? null,
        proxy: { configured: snapshot.proxy, available: snapshot.available },
        ahead: snapshot.ahead,
        behind: snapshot.behind,
        ...(remote === null
          ? { note: "no origin remote is configured: set one in Source Control -> Remote git" }
          : {}),
        ...(snapshot.error === null ? {} : { error: snapshot.error }),
      };
    },

    async stage(paths) {
      const state = await ready(ports, true);
      if ("declined" in state) return state.declined;
      const byPath = new Map(state.repo.changes.map((change) => [change.path, change] as const));
      const missing = paths.filter((path) => !byPath.has(path));
      if (missing.length > 0) return missingPaths("unstaged", missing);
      for (const path of paths) {
        const change = byPath.get(path);
        // oxlint-disable-next-line no-await-in-loop
        if (change !== undefined) await ports.stage(state.root, change);
      }
      await ports.refresh();
      return { ok: true, staged: [...paths] };
    },

    async unstage(paths) {
      const state = await ready(ports, true);
      if ("declined" in state) return state.declined;
      if (paths === undefined) {
        if (state.repo.staged.length === 0) return failed("nothing is staged");
        const staged = state.repo.staged.map((change) => change.path);
        await ports.unstageAll(state.root);
        await ports.refresh();
        return { ok: true, unstaged: staged };
      }
      const byPath = new Map(state.repo.staged.map((change) => [change.path, change] as const));
      const missing = paths.filter((path) => !byPath.has(path));
      if (missing.length > 0) return missingPaths("staged", missing);
      for (const path of paths) {
        const change = byPath.get(path);
        // oxlint-disable-next-line no-await-in-loop
        if (change !== undefined) await ports.unstage(state.root, change);
      }
      await ports.refresh();
      return { ok: true, unstaged: [...paths] };
    },

    async commit(message) {
      const state = await ready(ports, true);
      if ("declined" in state) return state.declined;
      if (state.repo.staged.length === 0) {
        return failed("nothing is staged: stage the changes with git_stage, then commit");
      }
      const committed = await ports.commit(state.root, message);
      await ports.refresh();
      if (!committed) {
        return failed(ports.repo(state.root)?.error ?? "the commit failed: check the git identity");
      }
      // A commit moves the local branch ahead: refresh the panel's ahead/behind too.
      if ((await originOf(ports, state.root)) !== null) await ports.detectRemote(state.root);
      return {
        ok: true,
        branch: ports.repo(state.root)?.currentBranch ?? null,
        message,
        note: "the commit is local: git_sync({ action: 'push' }) publishes it",
      };
    },

    async branch(action, name) {
      const state = await ready(ports, true);
      if ("declined" in state) return state.declined;
      const { root, repo } = state;
      if (action === "create") {
        if (repo.branches.includes(name)) {
          return failed("a branch named " + JSON.stringify(name) + " already exists");
        }
        await ports.createBranch(root, name);
        await ports.refresh();
        if (ports.repo(root)?.currentBranch !== name) {
          return failed(ports.repo(root)?.error ?? "the branch could not be created");
        }
        if ((await originOf(ports, root)) !== null) await ports.detectRemote(root);
        return { ok: true, action, branch: name };
      }
      if (repo.currentBranch === name) {
        return { ok: true, action, branch: name, note: "already on this branch" };
      }
      if (!repo.branches.includes(name)) {
        return failed(
          "no local branch named " +
            JSON.stringify(name) +
            ": create it with git_branch({ action: 'create', name })",
        );
      }
      // Data, not an exception, and nothing changes: a dirty tree is the model's to fix first.
      if (hasChanges(repo)) {
        return failed(
          "the working tree has uncommitted changes: commit them with git_commit before switching branches",
        );
      }
      await ports.checkoutBranch(root, name);
      await ports.refresh();
      if (ports.repo(root)?.currentBranch !== name) {
        return failed(ports.repo(root)?.error ?? "the branch switch failed");
      }
      return { ok: true, action, branch: name };
    },
  };
}
