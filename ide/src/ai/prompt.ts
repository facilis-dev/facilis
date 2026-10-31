// System prompt assembly for the IDE's AI chat (D-045, D-046; SPEC §9.2).
//
// Pure string building: no React, no controller, no i18n. The prompt is English because
// it is the model contract, not UI copy; the UI translates its own labels. The context is
// bounded here rather than by the caller so a large project cannot grow the request
// without limit.
//
// It never carries an API key: keys live in AiSettings and travel only to the provider
// as an Authorization header.

const MANIFEST_CHAR_CAP = 16_000;
const FILE_CONTENT_CHAR_CAP = 12_000;
const FILE_LIST_CAP = 500;

export interface PromptContext {
  /** The `/__facilis/manifest` payload, or null when no manifest was reachable. */
  manifest: Record<string, unknown> | null;
  /** The framework revision, or null when the manifest was unreachable. */
  manifestRevision: string | null;
  /** Project-relative paths. */
  files: readonly string[];
  /** The file open in the editor, project-relative; null when the editor is empty. */
  activeFile: { path: string; content: string } | null;
  /** Normally `facilis.config.ts`; null when the project has no config yet. */
  configFile: { path: string; content: string } | null;
}

/** The shared rules (SPEC §9.2) and the one-object response contract (SPEC §9.3 rule 15). */
export const SYSTEM_PROMPT = `You are the Facilis project assistant. You change a generated Facilis project by returning one JSON patch set per turn.

## Rules (SPEC §9.2)
1. Every API route is written with defineAuthorizedHandler — no exceptions.
2. Every route declares dbTables (an array, empty when it touches no table) and permission.
3. Any input a handler reads is validated with a Zod schema; invalid input returns 400.
4. Every scoped table added by the patch ships a pgPolicy and ENABLE ROW LEVEL SECURITY in the same patch.
5. Use the existing blocks; do not create new blocks unless the user asks.
6. Every user-facing string goes through t("key"), with the key registered in locales/en.json.
7. Make minimal patches and match the project's existing style.
8. Do not invent roles or permissions. If a route needs a permission or role that facilis.config.ts does not declare, add it to config.auth.permissions in the same patch and explain it in notes.
9. A destructive schema change (dropping or renaming a table or column) must set requires_confirmation to true.

## Response contract
Return exactly one JSON object and nothing else — no prose, no markdown, no code fence. Shape:
{
  "message": string,
  "patches": [
    { "path": string, "action": "create" | "update" | "delete", "content"?: string }
  ],
  "notes": string[],
  "requires_confirmation": boolean
}
- path is relative to the project root and must stay under server/, src/, db/, lib/, components/ or locales/.
- "create" and "update" carry the complete file content; "delete" omits content.
- Never put secrets, tokens, API keys or credentials in any file.`;

function capped(text: string, cap: number): string {
  if (text.length <= cap) return text;
  // A separate line, so the cut is visible exactly where it happened.
  return `${text.slice(0, cap)}\n[truncated]`;
}

function manifestSection(manifest: Record<string, unknown> | null): string {
  if (manifest === null) return "(unavailable)";
  try {
    return capped(JSON.stringify(manifest, null, 2), MANIFEST_CHAR_CAP);
  } catch {
    // A circular manifest would be a programming error; the prompt must still build.
    return "(unserialisable)";
  }
}

function fence(code: string): string[] {
  return ["```", code, "```"];
}

export function buildSystemPrompt(context: PromptContext): string {
  const files = context.files.toSorted();
  const lines: string[] = [SYSTEM_PROMPT, "", "## Project context", ""];

  lines.push(`Manifest revision: ${context.manifestRevision ?? "unreachable"}`, "");

  lines.push(`Project files (${files.length}):`);
  for (const path of files.slice(0, FILE_LIST_CAP)) lines.push(`- ${path}`);
  if (files.length > FILE_LIST_CAP) lines.push("[truncated]");
  lines.push("");

  if (context.configFile === null) {
    lines.push("Facilis config: (unavailable)", "");
  } else {
    lines.push(
      `Facilis config (${context.configFile.path}):`,
      ...fence(capped(context.configFile.content, FILE_CONTENT_CHAR_CAP)),
      "",
    );
  }

  if (context.activeFile === null) {
    lines.push("Active file: (none)", "");
  } else {
    lines.push(
      `Active file (${context.activeFile.path}):`,
      ...fence(capped(context.activeFile.content, FILE_CONTENT_CHAR_CAP)),
      "",
    );
  }

  lines.push("Manifest (JSON):", ...fence(manifestSection(context.manifest)));

  return lines.join("\n");
}
