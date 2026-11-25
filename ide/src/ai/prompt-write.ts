// The "Writing files" prompt section (D-181/D-192): the model changes source through the
// write_file/delete_file tools, one validated write at a time. The answer never carries file
// content: it is the turn's summary (plus an optional script), and the git-changes widget
// outside the conversation shows what changed.
//
// Kept beside prompt.ts so the prompt stays under the 300-line limit and the rules live with
// the tool family that enforces them.

export const WRITE_PROMPT = [
  "## Writing files (write tools)",
  "The write tools are the ONLY way you change source: the answer never carries file content or a patch set.",
  "- write_file({ path, content }) creates or replaces one complete file; delete_file({ path }) removes one. Every call runs the full 20-rule validation BEFORE anything is written and the file lands immediately when it passes.",
  "- Write in dependency order: facilis.config.ts (roles/permissions) and db/schema.ts first, then server routes, then src/ components and their locales keys, deletions last. A finding that something does not exist yet means the prerequisite has not been written; write it, then retry.",
  "- Never write a migration: db/migrations/ is the migration system's output, rendered from db/schema.ts when a release is built (D-158), and a write there is refused (rule 14). Change the schema and let the migration system produce the SQL; the role seed is generated the same way.",
  "- A rejected write writes NOTHING and returns errors/warnings with rule, file, message, fix_hint and line/excerpt: read the implicated files, fix them, retry in the same turn. The tool result is the feedback loop, there is no repair round for write tools.",
  "- A write refused with a git field is the clean-tree gate: the working tree has uncommitted changes, so the AI may not write. Never stage, commit or discard to get around it; the chat pauses and asks the user to commit-and-continue or stop.",
  "- Destructive schema changes are allowed once the gate passed: they are marked destructive and the user can undo the turn. Mention them in the message; never make one the user did not ask for.",
  "- A write that drops a table or a column is held for the user's confirmation: the tool answers with a 'confirmation' field and writes NOTHING, and the turn pauses. Do not retry the same write and do not work around it (no delete_file): after the user applies it the change is already written and the turn continues from there.",
  "- Write one file per call as you decide it; never postpone the changes to the end of the turn or batch them into a patch set.",
  "- Finish the turn with the normal AIResponse JSON and a message that summarises what changed: the path of every file you wrote or deleted, and one line each on what changed and why. The message is the user's summary of the finished work, not a plan for further work.",
].join("\n");

/** The write-mode output contract; the same text is reused by the repair report. */
export const WRITE_CONTRACT = [
  "Return exactly one JSON object and nothing else — no prose, no markdown, no code fence:",
  '{"message": string, "script"?: string}',
  '- "message" is what the user reads: the turn\'s final summary, naming every file you wrote or deleted and what changed in it.',
  '- "script" is the optional PTC program body that runs before the answer; every project change goes through write_file/delete_file inside a script.',
  '- Never return file content in the answer and never return a patch set: a "patches" field is rejected before it can reach the project.',
  "- Never put secrets, tokens, API keys or credentials in any file.",
].join("\n");

/** The response-contract section, as the system prompt renders it. */
export const WRITE_RESPONSE_CONTRACT = "## Response contract\n" + WRITE_CONTRACT;
