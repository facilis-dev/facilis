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

export const ALL_TOOL_SPECS: readonly PtcToolSpec[] = [...TOOL_SPECS, ...PREVIEW_TOOL_SPECS];
export const TOOL_NAMES = ALL_TOOL_SPECS.map((entry) => entry.name).join(", ");
export const SPEC_BY_NAME = new Map(ALL_TOOL_SPECS.map((entry) => [entry.name, entry] as const));
