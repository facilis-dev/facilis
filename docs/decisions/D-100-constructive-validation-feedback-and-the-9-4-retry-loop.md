# D-100 — Constructive validation feedback and the §9.4 retry loop
**Status:** accepted (2026-11-07)

The user reported that the IDE chat is unusable: when the 16-rule validator rejected the model's
patches, the turn dead-ended on a one-line error. `parseTurn()` already produced `fix_hint` and
`line`/`excerpt` per `ValidationError` (D-084), but nothing fed them back, so the model never
learned what to fix — the user could only retype the request and hope for a different answer.

**Decision.** The retry loop is implemented in the IDE chat, not in `@facilis.dev/ai`.

- `runTurn()` in `ide/src/ai/turn.ts` re-asks the model on a rejected answer up to
  `MAX_REPAIR_ATTEMPTS = 2` (§9.4's worst case is 3 attempts total; D-108 later removed the
  counter). The validator package
  stays a pure, synchronous function: it knows nothing about provider calls, messages or the VFS.
- A rejected answer is any failure, not only a validator error: unparseable JSON, an
  `AIResponse` contract violation or a rule violation. `AiParseFailure` carries the structured
  `findings` (rule, file, message, fix_hint, line, excerpt) and the rejected `patchedFiles`.
- `ide/src/ai/repair.ts` builds each repair request as one user-role turn: a numbered findings
  list, a reminder of the `AIResponse` contract, and the current content of the existing files
  the rejected patches tried to update or delete, capped like the rest of the prompt context.
  This is a clarification of §9.4's "not full files": a `create`/`update` patch carries the
  complete file, so re-emitting a whole-file rewrite from a `fix_hint` alone is a guess — the
  model needs the file it is editing. The cap keeps the context bounded.
- `SYSTEM_PROMPT` gains a "Validation repair" section: the repair report is not a new request;
  fix every finding and return one complete corrected object; when re-emitting a file keep every
  existing declaration (tables, columns, routes, config, keys); destructive changes only when
  asked, with `requires_confirmation: true` and a note.
- `state.repair = { attempt, max }` on the chat session exposes the progress to the UI.
- Final failure writes nothing: the findings are shown in the chat and the VFS is untouched.

**Rejected alternatives.** *Loop inside `@facilis.dev/ai`*: the validator is a pure function over
patches + context, while retrying needs the conversation, the provider stream and file reads, all
IDE-side. *Feed back `fix_hint`/`excerpt` only* (the literal §9.4 wording): documented, but it
dead-ends exactly on whole-file updates, the common case. *Unbounded file context*: the prompt
already has caps for a reason. *A snapshot of every project file*: needless tokens, and it leaks
files the rejected patch never touched.

**Consequences.** Worst case 3× the token cost of one answer; the repair context is capped per
file. Model B's `read_file` tool remains the general solution for pulling context on demand —
Model A cannot, so the loop pre-loads the files it knows the model needs. The prompt only
describes the protocol; the model still re-emits whole files, so the existing validator remains
the boundary. No write path changes: a failed turn has no proposal to apply.

**Verification.** Covered by `ide/src/ai/prompt.test.ts` (the new section and its position after
the response contract) and the IDE's repair/chat-session tests landed with task-1 (`runTurn` is
covered through ChatSession); the
Lead's final gate run (`pnpm lint`, `typecheck`, `test`, `build`) is the verification for
this change.
