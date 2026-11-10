// The tool catalogue the PTC prompt advertises (docs/PTC.md §6, D-101).
//
// Kept beside the router so both stay under the file-length limit: the prompt and the handlers
// read the same list, so a signature cannot drift from the handler that enforces it.

import type { PtcToolSpec } from "./protocol";

function spec(name: string, signature: string, description: string): PtcToolSpec {
  return { name, signature, description };
}

export const TOOL_SPECS: readonly PtcToolSpec[] = [
  spec("list_files", "list_files({ dir?, glob? })", "List readable project files (≤ 500)."),
  spec("read_file", "read_file({ path, startLine?, endLine? })", "Read a file; secrets redacted."),
  spec("search", "search({ query, glob?, maxResults? })", "Case-insensitive text search."),
  spec("get_schema", "get_schema({ table? })", "Drizzle table facts: columns, RLS, scope, source."),
  spec("get_routes", "get_routes({ prefix? })", "Route facts: method, path, permission, dbTables."),
  spec("get_config", "get_config()", "Parsed facilis.config.ts facts."),
  spec("get_manifest", "get_manifest()", "Live /__facilis/manifest envelope."),
  spec("get_project_summary", "get_project_summary()", "Project counts and top-level names."),
  spec(
    "validate",
    "validate({ patches, requiresConfirmation? })",
    "Run the §9.3 validator against the current project; cross-file rules judge the set as a whole.",
  ),
];

/**
 * Tools that drive the running preview (D-111). They are registered only when the IDE has a
 * preview session; the handlers return `{ available: false }` while the app is not running.
 */
export const PREVIEW_TOOL_SPECS: readonly PtcToolSpec[] = [
  spec("preview_state", "preview_state()", "Running app: URL, title, viewport, visible text."),
  spec(
    "preview_console",
    "preview_console()",
    "Recent console errors/warnings and uncaught exceptions.",
  ),
  spec("preview_network", "preview_network()", "Recent failed or non-2xx requests."),
  spec(
    "preview_dom",
    "preview_dom({ selector?, maxChars? })",
    "HTML of an element (or body text) in the running app.",
  ),
  spec("preview_click", "preview_click({ selector })", "Click an element to reproduce a flow."),
  spec("preview_fill", "preview_fill({ selector, text })", "Type into an input (input/change)."),
  spec("preview_open", "preview_open({ path })", "Navigate the preview to a project route."),
  spec("preview_wait", "preview_wait({ selector?, ms? })", "Wait for an element or a delay."),
  spec(
    "preview_screenshot",
    "preview_screenshot()",
    "Screenshot of the running app: the user sees it, vision models receive it.",
  ),
];

/**
 * Tools that read and rearrange the project graph (D-126). The graph is committed team state
 * under `.facilis/graph`, not source code, so an arrangement needs no patch proposal; the tools
 * are registered only when the IDE can reach that state.
 */
export const GRAPH_TOOL_SPECS: readonly PtcToolSpec[] = [
  spec(
    "graph_state",
    "graph_state()",
    "Project graph: nodes with positions, edges, notes, hidden edge kinds and collapsed tables.",
  ),
  spec(
    "graph_arrange",
    "graph_arrange({ moves?, curves?, notes?, delete_notes?, hidden_edges?, collapsed? })",
    "Arrange the project graph and write .facilis/graph immediately: move nodes, bend or reset edges (0,0), create/edit/delete notes (id absent = create), replace the hidden edge-kind set, collapse tables.",
  ),
];

/**
 * Tools that operate the project's own git repository and open pull requests (D-139). They exist
 * only when the host has the repository seam; an absent repository, a missing sign-in or an
 * unsupported provider is returned as data ({ available: false }).
 */
export const GIT_TOOL_SPECS: readonly PtcToolSpec[] = [
  spec(
    "git_status",
    "git_status()",
    "Repository state: current branch, staged and unstaged changes (repo-relative paths), ahead/behind when a remote is configured.",
  ),
  spec(
    "git_diff",
    "git_diff({ path?, staged? })",
    "Unified diff capped at 24 KB: staged = HEAD vs index, otherwise index vs working tree.",
  ),
  spec(
    "git_log",
    "git_log({ limit? })",
    "Recent commits: short oid, first line, author, timestamp (limit ≤ 30).",
  ),
  spec("git_branches", "git_branches()", "Current branch and the local branch list."),
  spec(
    "git_remote",
    "git_remote()",
    "Origin URL, provider, owner/repo when parseable, proxy availability, ahead/behind.",
  ),
  spec("git_stage", "git_stage({ paths })", "Stage repo-relative paths in the index."),
  spec("git_unstage", "git_unstage({ paths? })", "Unstage paths, or the whole index when omitted."),
  spec(
    "git_commit",
    "git_commit({ message })",
    "Commit the staged changes as a LOCAL commit; refuses when nothing is staged.",
  ),
  spec(
    "git_branch",
    "git_branch({ action, name })",
    'Create or switch a branch ("create" | "switch"); switch refuses a dirty working tree.',
  ),
  spec(
    "git_sync",
    "git_sync({ action })",
    '"fetch" | "pull" | "push" the current branch: needs the signed-in GitHub account; pull refuses a dirty tree.',
  ),
  spec(
    "git_pull_request",
    "git_pull_request({ title, body?, base?, head?, draft? })",
    "Open a GitHub pull request from the current branch; returns the number and url.",
  ),
];

/**
 * The specs to advertise: the base tools plus the families whose runtime seam exists. Kept here
 * so the router stays under the 300-line limit and the prompt receives exactly the tools the
 * handlers can dispatch.
 */
export function advertisedSpecs(
  hasPreview: boolean,
  hasGraph: boolean,
  hasGit: boolean,
): readonly PtcToolSpec[] {
  return [
    ...TOOL_SPECS,
    ...(hasPreview ? PREVIEW_TOOL_SPECS : []),
    ...(hasGraph ? GRAPH_TOOL_SPECS : []),
    ...(hasGit ? GIT_TOOL_SPECS : []),
  ];
}

/** The adapter the router calls: the host's seams decide which families are advertised. */
export function advertisedFor(host: {
  readonly preview?: unknown;
  readonly graph?: unknown;
  readonly git?: unknown;
}): readonly PtcToolSpec[] {
  return advertisedSpecs(
    host.preview !== undefined,
    host.graph !== undefined,
    host.git !== undefined,
  );
}

export const ALL_TOOL_SPECS: readonly PtcToolSpec[] = advertisedSpecs(true, true, true);
export const TOOL_NAMES = ALL_TOOL_SPECS.map((entry) => entry.name).join(", ");
export const SPEC_BY_NAME = new Map(ALL_TOOL_SPECS.map((entry) => [entry.name, entry] as const));
