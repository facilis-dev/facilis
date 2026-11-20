# D-192 — The answer is a summary, the commit message is generated, and the work lands in a git footer
**Status:** accepted (2026-11-18)

**Context.** D-191 made the write tools the practical source path but kept the returned patch set as
a fallback with a proposal + Apply card, and generated the gate's commit message from the changed
paths. The owner rejected both: the message must be a semantic summary of what was done (for
example "Aggiunto il calendario alla pagina todo"), at most 30 words, and the chat must not end on
a patch proposal at all. The work should be summarized by a git-changes widget outside the
conversation.

**Decision.**

- **The answer never carries source.** The `AIResponse` contract is
  `{"message": string, "script"?: string}`; a `patches` field is a contract error and the repair
  turn asks for those files through the tools. `parseAiResponse` only checks the shape, the turn
  loop is explore → write → summary, and the repair loop covers malformed JSON/contract only
  (`ide/src/ai/response.ts`, `turn.ts`, `repair.ts`).
- **The proposal path is deleted, not hidden.** `AiResponse.patches/continue/notes/
  requiresConfirmation`, `ChatState.proposal/applied/undo/patchParts`, the `"applying"` phase,
  `chat-proposal.ts`, `chat-apply.ts`, `chat-actions.ts`, `patch-set.ts`, `salvage.ts`,
  `ChatProposalView` and `ChatWritesView` (with their tests) are gone. `validate` stays as the
  pre-write self-check; `write_file`/`delete_file` still validate every file before
  `applyPatch` (D-181, invariant 9).
- **Generated commit message (max 30 words).** When the gate pauses, `GitSafety.diff()` returns
  the uncommitted diff (staged and unstaged, through the git tool family's own diff) and
  `commit-message.ts` makes one small, non-streaming model call: one sentence in the UI language,
  capped at 30 words, stripped of fences/labels and editable in the card. No model or no diff falls
  back to a short deterministic message. The same pieces are meant for Source Control's own commit
  box later.
- **Git-changes footer.** `ChatGitChangesView` sits at the bottom of the chat panel, outside the
  scrolling transcript, and merges the SCM snapshot (staged + unstaged) with the turn journal so
  the AI's writes appear before the SCM walk catches up: A/M/D letters, line counts for the turn's
  files, the destructive badge, **Undo this turn** and **Source Control**. It replaces the
  in-transcript "files the AI wrote" card and is the per-turn summary.

**Rejected alternatives.** *Keep the returned-patch fallback hidden*: still two write paths, two
Undo stories and the card the owner asked to remove. *Silently ignore a returned patch set*: the
user would see "Done" with nothing applied. *A file-list commit message* (D-191): not a summary.
*Generate the message on every keystroke or at commit time*: one call when the gate appears is
enough, and the user's edit is the final word. *Put the widget inside the transcript*: it scrolls
away exactly when the user wants to review the work.

**Consequences.** A gate adds one small model call; when it fails the card still opens with the
fallback text. The answer protocol lost `notes`/parts, so the final message must carry the summary
and the destructive mentions. The IDE has no Apply path any more: a model that returns patches is
corrected, never applied. The footer is SCM-driven, so a commit, discard or manual edit elsewhere
updates it too; the journal is only the immediate overlay.

**Verification.** Targeted suites: `pnpm --filter @facilis.dev/ide exec vitest run
src/ai/commit-message.test.ts src/ai/chat-git-gate.test.ts src/ai/response.test.ts
src/ai/prompt.test.ts src/ai/turn.test.ts src/ai/repair.test.ts src/ai/chat-session.test.ts
src/ai/mock.test.ts`. Full IDE suite 164 files / 1380 tests, IDE `pnpm typecheck`, `pnpm lint`
(0 errors; file-length and theme gates pass) and `pnpm build` in this worktree.
