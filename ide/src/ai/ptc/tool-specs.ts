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

export const TOOL_NAMES = TOOL_SPECS.map((entry) => entry.name).join(", ");
export const SPEC_BY_NAME = new Map(TOOL_SPECS.map((entry) => [entry.name, entry] as const));
