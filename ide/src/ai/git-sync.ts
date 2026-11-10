// The remote half of the git tool family (D-139): fetch/pull/push and pull requests.
//
// A browser cannot speak git's smart-HTTP directly; GitRemoteSession does it through the
// deployment's same-origin proxy, and GitHub's REST API is called directly (it sends CORS
// headers). Both paths need the tab-memory GitHub OAuth token (D-082): the tools read it per
// call from githubSessionToken() through the GitPorts seam and never store, log or return it.
//
// v1 signs in to GitHub only, so a GitLab/Gitea remote answers { available: false } with
// guidance instead of inventing a credential store. Refusals are data: not signed in is
// { available: false }, a dirty tree before a pull is { ok: false, reason } and changes nothing.

import { parseGitRepo } from "@/vv/git-provider";
import type { GitAccess, GitPorts } from "./git-access";
import {
  SIGN_IN_REASON,
  failed,
  hasChanges,
  originOf,
  providerGate,
  providerOf,
  ready,
  unavailable,
} from "./git-common";
import type { PtcJson } from "./ptc/protocol";

type RemoteTool = "sync" | "pullRequest";

const API_VERSION = "2022-11-28";
const HOST = "GitHub";

/** The actionable message per status; a response body is never read into it. */
function failure(status: number): string {
  if (status === 401) {
    return HOST + " rejected the token (HTTP 401): sign in again in Source Control -> Remote git";
  }
  if (status === 403) {
    return (
      HOST +
      " refused the request (HTTP 403): the signed-in account may lack pull-request permission on this repository"
    );
  }
  if (status === 404) {
    return (
      HOST +
      " could not find the repository (HTTP 404): check the origin URL and that the account can read it"
    );
  }
  if (status === 422) {
    return (
      HOST +
      " rejected the pull request (HTTP 422): check that head and base exist and that head has commits the base does not"
    );
  }
  return HOST + " returned HTTP " + status;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

interface PullRequestCall {
  readonly api: string;
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
  readonly title: string;
  readonly body?: string;
  readonly base: string;
  readonly head: string;
  readonly draft?: boolean;
  readonly fetchApi: (url: string, init: RequestInit) => Promise<Response>;
}

/** POST /repos/{owner}/{repo}/pulls: the only network write the family performs off-proxy. */
async function openPullRequest(call: PullRequestCall): Promise<PtcJson> {
  const url =
    call.api +
    "/repos/" +
    encodeURIComponent(call.owner) +
    "/" +
    encodeURIComponent(call.repo) +
    "/pulls";
  const payload = {
    title: call.title,
    base: call.base,
    head: call.head,
    ...(call.body === undefined ? {} : { body: call.body }),
    ...(call.draft === undefined ? {} : { draft: call.draft }),
  };
  let response: Response;
  try {
    response = await call.fetchApi(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        Authorization: "Bearer " + call.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      return failed(
        "could not reach " +
          HOST +
          ": its API must allow CORS (a self-hosted server needs it enabled)",
      );
    }
    throw error;
  }
  if (!response.ok) return failed(failure(response.status));
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const record = recordOf(data);
  const number = record["number"];
  const htmlUrl = record["html_url"];
  if (typeof number !== "number" || typeof htmlUrl !== "string") {
    return failed(HOST + " created the pull request but returned an unexpected payload");
  }
  return { ok: true, number, url: htmlUrl };
}

export function createGitSyncOperations(ports: GitPorts): Pick<GitAccess, RemoteTool> {
  return {
    async sync(action) {
      const state = await ready(ports, false);
      if ("declined" in state) return state.declined;
      const { root, repo } = state;
      const remote = await originOf(ports, root);
      if (remote === null) {
        return failed("no origin remote is configured: set one in Source Control -> Remote git");
      }
      const gate = providerGate(providerOf(remote.url));
      if (gate !== null) return gate;
      const token = ports.token();
      if (token === null) return unavailable(SIGN_IN_REASON);
      await ports.detectRemote(root);
      const before = ports.remote();
      if (!before.available) {
        return unavailable(
          before.error ?? "the git proxy is not available in this deployment: remote git needs it",
        );
      }
      // A pull merges into the working tree; a dirty tree could lose work, so refuse as data.
      if (action === "pull" && hasChanges(repo)) {
        return failed(
          "the working tree has uncommitted changes: commit them with git_commit before pulling",
        );
      }
      const credentials = { token };
      let done: boolean;
      if (action === "fetch") done = await ports.fetch(root, credentials);
      else if (action === "pull") done = await ports.pull(root, credentials);
      else done = await ports.push(root, credentials);
      await ports.refresh();
      if (!done) {
        return failed(
          ports.remote().error ?? action + " failed: check the remote and the signed-in account",
        );
      }
      const after = ports.remote();
      return {
        ok: true,
        action,
        branch: after.branch ?? repo.currentBranch,
        ahead: after.ahead,
        behind: after.behind,
      };
    },

    async pullRequest(input) {
      const state = await ready(ports, false);
      if ("declined" in state) return state.declined;
      const { root, repo } = state;
      const remote = await originOf(ports, root);
      if (remote === null) {
        return failed("no origin remote is configured: set one in Source Control -> Remote git");
      }
      const gate = providerGate(providerOf(remote.url));
      if (gate !== null) return gate;
      const token = ports.token();
      if (token === null) return unavailable(SIGN_IN_REASON);
      const ref = parseGitRepo(remote.url, "github");
      if (ref === null) {
        return unavailable(
          "the origin URL is not an https://github.com/<owner>/<repo> URL: create the pull request on github.com",
        );
      }
      const head = input.head ?? repo.currentBranch;
      const base = input.base ?? "main";
      if (head === null) {
        return failed("no branch is checked out: switch to the branch you want to merge first");
      }
      if (head === base) {
        return failed(
          "head and base are the same branch (" +
            head +
            "): pass a different base or check out another branch",
        );
      }
      return openPullRequest({
        api: ref.api,
        owner: ref.owner,
        repo: ref.repo,
        token,
        title: input.title,
        ...(input.body === undefined ? {} : { body: input.body }),
        base,
        head,
        ...(input.draft === undefined ? {} : { draft: input.draft }),
        fetchApi: (url, init) => ports.fetchApi(url, init),
      });
    },
  };
}
