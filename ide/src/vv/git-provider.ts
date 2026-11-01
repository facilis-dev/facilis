// Git hosts the importer can read from a browser tab (D-073).
//
// A browser cannot speak git's smart-HTTP or SSH directly: there is no raw socket, and a
// cross-origin fetch needs CORS. Every provider here is therefore read through its HTTPS
// API, which must send CORS headers: GitHub, GitLab and Gitea/Forgejo do (self-hosted too,
// but Gitea/Forgejo need [cors] enabled). SSH is not an option in a tab and a host without
// CORS cannot be imported at all — that is a server setting, not a client workaround.

export type GitProvider = "github" | "gitlab" | "gitea";

/** The host picker; brand names, so they are not translated (the D-069 rule). */
export const GIT_PROVIDERS: readonly { id: GitProvider; label: string }[] = [
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "gitea", label: "Gitea / Forgejo" },
];

export interface GitRepoRef {
  provider: GitProvider;
  /** API root the fetcher calls: api.github.com, <host>/api/v4, <host>/api/v1. */
  api: string;
  /** Owner on GitHub/Gitea; the namespace path on GitLab (nested groups included). */
  owner: string;
  repo: string;
  ref?: string;
}

/** A pasted token is data: trim it and refuse the shapes that are certainly not one. */
export function normalizeGitToken(raw: string | undefined | null): string | null {
  if (raw === null || raw === undefined) return null;
  const token = raw.trim();
  if (token === "" || token.length > 255 || /\s/.test(token)) return null;
  return token;
}

/** The host a URL-ish input names, or null when the input is an owner/repo shorthand. */
export function hostOfGitInput(input: string): string | null {
  const value = input.trim();
  const isUrl = /^https?:\/\//i.test(value);
  const first = isUrl ? "" : (value.split("/")[0] ?? "");
  if (!isUrl && !first.includes(".")) return null;
  try {
    return new URL(isUrl ? value : "https://" + value).hostname;
  } catch {
    return null;
  }
}

/** Only a suggestion for the picker: the user can always choose another host. */
export function detectGitProvider(host: string): GitProvider | null {
  const h = host.toLowerCase();
  if (h === "github.com") return "github";
  if (h === "gitlab.com" || h.includes("gitlab")) return "gitlab";
  if (h === "gitea.com" || h.includes("gitea") || h.includes("forgejo")) return "gitea";
  return null;
}

/** Auth header per host: GitHub/Gitea take a bearer, GitLab its own header. */
export function gitAuthHeaders(
  provider: GitProvider,
  token: string | null,
): Record<string, string> {
  if (token === null) return {};
  if (provider === "gitlab") return { "PRIVATE-TOKEN": token };
  if (provider === "gitea") return { Authorization: "token " + token };
  return { Authorization: "Bearer " + token };
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

/** Where the API lives for a host: github.com has its own, the others expose /api/*. */
function apiFor(provider: GitProvider, host: string): string {
  if (provider === "github") return "https://api.github.com";
  return "https://" + host + (provider === "gitlab" ? "/api/v4" : "/api/v1");
}

function hostFor(provider: GitProvider): string {
  return provider === "github" ? "github.com" : provider === "gitlab" ? "gitlab.com" : "gitea.com";
}

/** \`owner/repo\`, \`owner/repo@ref\`, \`owner/repo#ref\`; GitLab keeps nested groups. */
function parseShorthand(input: string, provider: GitProvider): GitRepoRef | null {
  let rest = input;
  let ref: string | undefined;
  const marker = rest.search(/[@#]/);
  if (marker !== -1) {
    ref = rest.slice(marker + 1) || undefined;
    rest = rest.slice(0, marker);
  }
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const repo = stripGitSuffix(parts[parts.length - 1]);
  const ownerParts = parts.slice(0, -1);
  // GitLab is the only host where a project path may be deeper than owner/repo.
  if (provider !== "gitlab" && ownerParts.length !== 1) return null;
  if (repo === "" || ownerParts.length === 0) return null;
  return {
    provider,
    api: apiFor(provider, hostFor(provider)),
    owner: ownerParts.join("/"),
    repo,
    ref,
  };
}

function parseUrl(input: string, provider: GitProvider): GitRepoRef | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : "https://" + input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  // GitHub Enterprise is not supported: it serves /api/v3 and its raw host differs, so
  // the GitHub adapter's fixed api.github.com/raw URLs would be wrong (D-073).
  if (provider === "github" && host !== "github.com") return null;
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length < 2) return null;

  let ref: string | undefined;
  let path = segments;
  if (provider === "github") {
    const tree = segments[2] === "tree" || segments[2] === "blob" ? 2 : -1;
    if (tree !== -1) {
      path = segments.slice(0, tree);
      ref = segments.slice(tree + 1).join("/") || undefined;
    }
  } else if (provider === "gitlab") {
    // https://host/group/sub/repo/-/tree/<ref> (or /-/blob/<ref>/<file>)
    const marker = segments.indexOf("-");
    const kind = marker === -1 ? undefined : segments[marker + 1];
    if (marker !== -1 && (kind === "tree" || kind === "blob")) {
      path = segments.slice(0, marker);
      ref = segments.slice(marker + 2).join("/") || undefined;
    }
  } else {
    // https://host/owner/repo/src/branch/<ref> (or /src/tag/, /src/commit/)
    const marker = segments.indexOf("src");
    const kind = marker === -1 ? undefined : segments[marker + 1];
    if (marker !== -1 && (kind === "branch" || kind === "tag" || kind === "commit")) {
      path = segments.slice(0, marker);
      ref = segments.slice(marker + 2).join("/") || undefined;
    }
  }

  if (path.length < 2) return null;
  const repo = stripGitSuffix(path[path.length - 1]);
  if (repo === "") return null;
  return {
    provider,
    api: apiFor(provider, host),
    owner: path.slice(0, -1).join("/"),
    repo,
    ref,
  };
}

/**
 * Read a pasted repository reference. Shorthands resolve to the hosted service
 * (github.com / gitlab.com / gitea.com); a self-hosted server needs its URL.
 */
export function parseGitRepo(input: string, provider: GitProvider = "github"): GitRepoRef | null {
  const value = input.trim();
  if (value === "") return null;
  return hostOfGitInput(value) === null
    ? parseShorthand(value, provider)
    : parseUrl(value, provider);
}
