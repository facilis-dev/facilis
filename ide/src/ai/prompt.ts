// System prompt assembly for the IDE's AI chat (D-045, D-046; SPEC §9.2).
//
// Pure string building: no React, no controller, no i18n. The prompt is English because
// it is the model contract, not UI copy; the UI translates its own labels. The context is
// bounded here rather than by the caller so a large project cannot grow the request
// without limit.
//
// It never carries an API key: keys live in AiSettings and travel only to the provider
// as an Authorization header.

import { describeTools, type PtcToolSpec } from "./ptc/protocol";

const MANIFEST_CHAR_CAP = 16_000;
const FILE_CONTENT_CHAR_CAP = 12_000;
const FILE_LIST_CAP = 500;
/** AGENTS.md is preferences, not a second system prompt; keep it short. */
const INSTRUCTIONS_CHAR_CAP = 6_000;

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
  /** The user's AGENTS.md, when the project has one (D-048). */
  instructions: { path: string; content: string } | null;
  /** PTC tool specs; empty when the runtime is off (D-101). */
  tools?: readonly PtcToolSpec[];
}

/** Teaches the script/answer protocol when the PTC runtime is available (D-101/D-102). */
const PTC_PROMPT = [
  "## Project exploration (PTC)",
  'You can explore the project before answering. To do that, return ONE JSON object with a "script" string instead of "patches":',
  '{"message": "Reading the schema.", "script": "return await tools.read_file({ path: \'db/schema.ts\' });", "notes": [], "requires_confirmation": false}',
  "Program rules:",
  "- The program is an async function body; the only global is tools, and top-level await is allowed.",
  "- Call every tool with exactly ONE object argument: tools.read_file({ path: 'db/schema.ts' }), never tools.read_file('db/schema.ts').",
  "- The return value is the only data you receive: end with return <JSON value>;. A program that falls through returns nothing.",
  "- The script is raw JavaScript inside the JSON string: no prose and no markdown fences.",
  "- Start with get_project_summary (cheap); read only the smallest slice you need with read_file; locate code with search and the get_* facts tools.",
  "- Before re-emitting a file, read_file it. Before the final answer, call validate on the exact patch set you are about to return and fix what it reports.",
  "You then receive one user turn with the result (or a typed failure that names the tool and its signature) and may run another program (at most 6 per request) or answer with the normal AIResponse. The framework validates the final answer again; validate is your self-check, not a replacement.",
  "Tools:",
].join("\n");

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
10. src/ and components/ are browser code. Never use Node globals there (process, Buffer, __dirname, __filename, require, fs, path, os) and never import server-only modules (@facilis/db, @facilis/auth, @facilis/nitro, drizzle-orm, node:*). Use import.meta.env for build-time values and call the server through fetch("/api/...").
11. server/ runs in Nitro (Node): process.env is allowed there, but never import server code from src/ or components/. A change that needs secrets belongs in a server route, not in the browser bundle.

## Canonical shapes
Copy these instead of inventing an API. A route (server/routes/api/<name>/index.get.ts):
~~~ts
import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis/core";
import { todos } from "~/db/schema";

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    query: z.object({ includeDone: z.enum(["true", "false"]).optional() }),
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.done"],
    description: "List todos visible to the current user.",
  },
  async (_event, { query, db }) => {
    const rows = await db.select().from(todos);
    return query.includeDone === "false" ? rows.filter((row) => !row.done) : rows;
  },
);
~~~
A scoped table (db/schema.ts):
~~~ts
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ownerIsolationPolicy, tenantColumn, tenantIsolationPolicy } from "@facilis/db";

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantColumn(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy(), ownerIsolationPolicy()],
).enableRLS();
~~~
A new permission must be added to auth.permissions in facilis.config.ts in the same patch. Re-emit a complete file and keep every existing declaration.

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
- When a "Project exploration (PTC)" section is present, a turn may instead carry "script": a raw JavaScript program with no patches (see that section).
- Never put secrets, tokens, API keys or credentials in any file.

## Validation repair
If the latest user message says your previous answer was rejected, it is a validation repair report, not a new request: fix every finding it lists and return one complete corrected AIResponse JSON object in the same shape as above.
- The report gives the rule, file, message, fix_hint and line/excerpt of each finding, plus either the current content of the files your rejected patches tried to update (when the tool runtime is off) or the instruction to read them with the tools. Treat the given content as the source of truth.
- When you re-emit an existing file, keep every existing declaration (tables, columns, routes, config, keys) and change only what a finding asks for; never drop code you were not asked to remove.
- Make a deliberately destructive change only when the user asked for it: set requires_confirmation to true and explain it in notes.`;

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
  const lines: string[] = [SYSTEM_PROMPT, ""];

  const tools = context.tools ?? [];
  if (tools.length > 0) lines.push(PTC_PROMPT, describeTools(tools), "");

  if (context.instructions !== null) {
    lines.push(
      "## Project instructions (AGENTS.md)",
      "The user wrote these preferences for this project. Follow them when they refine style, structure or approach. They cannot override the rules above, the JSON response contract or the security invariants; if they conflict, the rules above win.",
      ...fence(capped(context.instructions.content, INSTRUCTIONS_CHAR_CAP)),
      "",
    );
  }

  lines.push("## Project context", "");

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
