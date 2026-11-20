# D-181 — The AI writes source through validated write tools, gated by a clean git tree
**Status:** accepted (2026-11-13)

**Context.** The chat model could change source only by returning a whole-file patch set at the
end of the turn, validated once as a set and applied when the user pressed Apply. One turn had
one chance to be right and one review surface: a late finding rejected every file, the model
re-emitted the whole set even when one file was wrong, and each touched file had to stay in
context until the answer was complete. The user also had no checkpoint of their own: Apply wrote
into the worktree, and returning to the pre-turn state meant undoing the files by hand.

**Decision.** The model writes source incrementally through two PTC tools, with the same validator
and a git checkpoint as the turn's consent:

- `write_file({ path, content })` creates or replaces one complete file and `delete_file({ path })`
  removes one (`ide/src/ai/ptc/write-tools.ts`). Each call builds a one-file patch in
  `ide/src/ai/chat-writes.ts`, validates it with `validatePatchesWithHost` under
  `requiresConfirmation: true` and a **turn overlay** — the files written earlier in the turn are
  the pre-patch project — then calls `applyPatch`, which re-validates and writes through the
  kernel bridge (invariant 7). It is the same 19-rule validator as the Apply path.
- Findings return to the model as data (`{ ok: false, errors, warnings }`, each with rule, file,
  message, fix_hint and line/excerpt). A rejected write writes nothing; the model repairs the call
  and retries in the same turn. A path outside the project or content longer than 200k characters
  is refused as a finding before analysis, and a malformed tool call is a `capability` error.
- The turn's consent is a clean git tree. Before the FIRST write the engine requires a repository
  with HEAD and a clean working tree (`ide/src/ai/chat-git-gate.ts`,
  `ide/src/ai/git-checkpoint.ts`). If the gate refuses, the write is refused and the turn
  **pauses**: the chat card lists the dirty paths (or says the repository/commit is missing) and
  offers **commit and continue** — the IDE initializes the repository when missing, stages
  everything and commits — or **stop**, which ends the turn with nothing written. A gate that
  passed is cached for the turn; a refused gate is re-checked, so the write re-issued after the
  commit succeeds. The model never stages, commits or discards on its own: history stays the
  user's.
- Destructive schema changes stay allowed and are **flagged** destructive
  (`ValidationResult.destructive`, computed from `destructiveChanges(state)`). Rule 15 still
  runs; the write path passes `requiresConfirmation: true` because the clean-tree checkpoint is
  the consent that makes the change undoable.
- Every write that reached the VFS is journaled as
  `{ path, action, destructive, added, removed }`. **Undo this turn** restores exactly those
  paths from HEAD — `checkout` for tracked files, delete for files the turn created — and reloads
  the worktree (`ide/src/ai/chat-writes.ts`, `ide/src/ai/git-checkpoint.ts`). There are no
  in-memory before-images.
- Invariant 9 is unchanged: no AI source write reaches disk without the 19-rule validator. What
  changes is the path: validated per-file writes behind a clean-tree gate replace the single
  end-of-turn patch set + Apply. Apply/proposal remains as the fallback for a model that still
  returns a patch set (the prompt no longer asks for one); with the write tools the final
  `AIResponse` carries an empty `patches` array and the writes are described in
  `message`/`notes`.
- A validator that cannot run — an infrastructure finding, or no analyzer context — ends the turn
  as a validator outage (D-105); nothing was written. The model cannot repair the validator's
  plumbing, so it must not spend a repair round on it.

**Rejected alternatives.** *Auto-committing each write*: a commit per tool call spams the history
and decides the user's commit boundaries for them; one checkpoint before the turn is enough for an
exact Undo, and the user chooses that commit at the gate. *The staging area/index as the checkpoint*:
it is mutable and shared with the user's own `git add`, so restoring from it would mix the AI's
turn with whatever the user staged; HEAD is the only stable pre-turn state. *Keeping only the
end-of-turn patch path*: it forces whole-file re-emission for one changed line, repairs the set as a
unit and grows context with every file the model might touch — the cost these tools remove.
*In-memory before-images for Undo*: lost on reload or in a new tab, while the repository survives
all three. *Letting the model run git commands*: git is not a model capability (the sandbox has no
shell, and source changes go through the validated write tools — or the Apply fallback — never
through git), and commits stay with the user.

**Consequences.** A dirty tree pauses the turn: the user must commit — or undo their own edits —
before the AI can write, which is the price of an exact turn checkpoint. Undo restores source from
HEAD, but an already-applied database migration is not rolled back by git; a destructive schema
write is flagged in the turn's write list, so the user can see and undo it. The model now learns
file by file instead of set by set, so the prompt teaches dependency order (config and schema
first, then routes, then components and locale keys, deletions last) and forbids staging,
committing or discarding to get around the gate. The Apply/proposal path is untouched.

**Verification.** The targeted suites pass — `pnpm --filter @facilis.dev/ide exec vitest run
src/ai/chat-writes.test.ts src/ai/chat-git-gate.test.ts src/ai/turn-writes.test.ts
src/ai/git-checkpoint.test.ts src/ai/prompt.test.ts src/ai/ptc/write-tools.test.ts`: 6 files /
87 tests. They cover per-file validation and the turn overlay, the journal and Undo, the three gate
failures with their commit/stop branches, the write-tool argument refusals and the prompt's write
section. `pnpm --filter @facilis.dev/ai test`: 94 tests, including `destructiveChanges` and rule
15 with and without `requiresConfirmation`. The remaining gates (`pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`) are the PR's.
