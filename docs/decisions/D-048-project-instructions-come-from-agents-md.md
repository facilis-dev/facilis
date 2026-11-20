# D-048 — Project instructions come from AGENTS.md
**Status:** accepted (2026-10-31)

The chat's context was entirely automatic: manifest, file list, open buffer and
`facilis.config.ts`. That is what keeps patches applicable, but it leaves no room for the
project's own conventions — the user asked for a way to customise the context, even partially.
The first, deliberately small step is a project instructions file rather than context switches:
the assistant's behaviour is what a user actually wants to steer, and a plain file is portable.

**Decision.** The project's instructions live in a root `AGENTS.md`, the name the agent-harness
ecosystem already uses. It is read on every turn, after the framework rules and before the
project context, under `## Project instructions (AGENTS.md)` with an explicit precedence
sentence: it refines style, structure and approach but cannot override the rules, the JSON
response contract or the security invariants. The unsaved Monaco buffer wins over the VFS copy
(same rule as the active file), the content is capped at 6,000 characters with a `[truncated]`
marker, and the file is simply absent from the prompt when the project has none.
The chat header gets a **Project instructions** action that opens the file in the editor and
creates it from a short template through the validated `applyPatch()` path when missing; it is
never overwritten. The composer's context line appends `AGENTS.md` when the last turn included
it.

**Why a file.** It is versioned with the project and travels with a clone, needs no IDE storage,
and works for anyone using another harness that reads `AGENTS.md`. Making it an IDE setting
would hide it from the repository and from teammates.

**Scope.** This is level 1 of the customisation discussed with the user: no per-turn selection of
context sections, no file attachments, no exclusions, and no replacement of the system prompt
(levels 2-3). Those remain open; the seam is `PromptContext` / `buildChatContext`.

**Verification.** `prompt.test.ts` pins the section order, the precedence sentence, the omission
and the cap; `chat-context.test.ts` pins the unsaved-buffer precedence; `instructions.test.ts`
pins create/no-overwrite/refused-write; `chat-session.test.ts` pins the action's write + open;
and the smoke clicks the action and asserts `AGENTS.md` lands in the VFS.

**Consequences:** a project can now tell the assistant how it wants to be worked on without the
user re-stating it in every conversation; because it is a normal file, the assistant can also
update it (no special-casing), and a clone carries the instructions.
