# D-191 — The chat writes only through the tools, and the gate's commit message is the user's
**Status:** superseded in part by D-192 (2026-11-18) — the file-list message became a generated
summary, and the returned-patch fallback was removed.

**Context.** D-181 made the validated write tools the normal source path but kept the end-of-turn
patch set + Apply as a fallback: the system prompt still described a patch-set contract and the
model could choose it, so a turn could finish on the "Modifiche proposte / Applica tutto" card —
the review surface D-181 set out to replace. The clean-tree gate's "commit and continue" also
committed with a hardcoded message ("chore: save work before AI changes"), so the user's own
pending work entered history under a message they never saw or could change.

**Decision.** Three changes, all in the IDE chat:

- **Write-only answers.** When `write_file`/`delete_file` are registered (always in the IDE),
  `buildSystemPrompt` replaces the patch-set contract with `WRITE_CONTRACT`
  (`ide/src/ai/prompt-write.ts`): the answer is
  `{"message": string, "patches": [], "notes": string[], "requires_confirmation": boolean}`;
  `patches` is always empty and `message` is the turn's summary, naming every file written or
  deleted. The *Large patch sets* and patch *Validation repair* sections are not shipped in write
  mode, and the shared rules no longer talk about patches if the write tools are the path.
- **Enforcement.** `runTurn` refuses an answer that carries patches or `"continue"`
  (`refusePatchSet` in `ide/src/ai/turn-writes.ts`): the rejected answer goes back with an
  instruction to write those files through the tools, and the loop continues. The cut-off salvage
  path is disabled in write mode, and `repair.ts` carries the write-only contract and tool
  guidance. `ChatSession` builds a proposal only when no write engine is registered, so the card
  is unreachable in the IDE.
- **Editable commit message.** The gate generates a starting message from the change list
  (`ide/src/ai/commit-message.ts`): a Conventional-Commits subject plus the paths grouped by
  status, capped at 30 and counted. It is stored in `ChatGitGateState.message`, pre-fills the
  card's textarea, and the edited text travels through `GitSafety.commitAll(message)` to Source
  Control; the button stays disabled while the message is blank.

**Consequences.** A normal change never ends on a proposal card: the model writes as it goes and
the final answer is the summary the user reads, with `ChatWritesView` listing the files and
offering Undo. A model that still returns a patch set costs one extra call and cannot apply it —
the failure is visible as a rejected answer, not as a silently dropped change. The proposal +
Apply code survives as the no-write-engine fallback (tests and non-IDE hosts) and is documented as
such, not deleted. Committing at the gate is now a real user commit: the generated message is a
default, and the user may rewrite it before it becomes history.

**Rejected alternatives.** *Keep the fallback reachable in the IDE*: that is the card the owner
asked to remove, and two paths for the same write make Undo and the validator story ambiguous.
*Silently ignore a returned patch set*: the user would see "Done" with nothing applied. *Auto-apply
a returned set*: it bypasses the per-file write journal and the gate that D-181 made the consent.
*Ask a model to generate the commit message*: an extra paid call before the user can commit, for a
message they will usually edit anyway; the file/status description is deterministic, local and
testable, and the user's edit is the real message.

**Verification.** Targeted suites:
`pnpm --filter @facilis.dev/ide exec vitest run src/ai/commit-message.test.ts
src/ai/chat-git-gate.test.ts src/ai/git-checkpoint.test.ts src/ai/prompt.test.ts src/ai/turn.test.ts
src/ai/turn-writes.test.ts src/ai/repair.test.ts src/ai/chat-writes.test.ts` — 8 files, 117 tests,
all passing. Full IDE suite 170 files / 1427 tests, IDE `pnpm typecheck`, `pnpm lint` (0 errors;
the file-length and theme gates pass) in this worktree.
