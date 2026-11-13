// The "Writing files" prompt section (D-181): the model changes source through the
// write_file/delete_file tools, one validated write at a time, instead of returning a
// whole-file patch set at the end. Kept beside prompt.ts so the prompt stays under the
// 300-line limit and the rules live with the tool family that enforces them.

export const WRITE_PROMPT = [
  "## Writing files (write tools)",
  "When write_file/delete_file are registered, you change the project with them instead of returning patches:",
  "- write_file({ path, content }) creates or replaces one complete file; delete_file({ path }) removes one. Every call runs the full 19-rule validation BEFORE anything is written and the file lands immediately when it passes.",
  "- Write in dependency order: facilis.config.ts (roles/permissions) and db/schema.ts first, then server routes, then src/ components and their locales keys, deletions last. A finding that something does not exist yet means the prerequisite has not been written; write it, then retry.",
  "- A rejected write writes NOTHING and returns errors/warnings with rule, file, message, fix_hint and line/excerpt: read the implicated files, fix them, retry in the same turn. The tool result is the feedback loop, there is no repair round for write tools.",
  "- A write refused with a git field is the clean-tree gate: the working tree has uncommitted changes, so the AI may not write. Never stage, commit or discard to get around it; the chat pauses and asks the user to commit-and-continue or stop.",
  "- Destructive schema changes are allowed once the gate passed: they are marked destructive and the user can undo the turn. Mention them in notes; never make one the user did not ask for.",
  "- Finish the turn with the normal AIResponse JSON but an EMPTY patches array; message and notes describe what changed. Do not re-emit files you already wrote.",
].join("\n");
