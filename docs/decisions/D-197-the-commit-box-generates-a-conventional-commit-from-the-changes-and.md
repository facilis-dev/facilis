# D-197 — The commit box generates a Conventional Commit from the changes, and never commits it
**Status:** accepted (2026-11-19)

**Context.** Source Control's commit box was a plain textarea: the message was the one part of a
commit the IDE left entirely to the user, although `callModel`, the saved provider/model/key and
the git `diff` path already existed. Reusing them from the panel makes this the **first model
call in the IDE that is not a chat turn** — and D-181 gates AI source writes on the validated
write tools, so a second model call site needs an explicit decision rather than an assumption.
D-192's checkpoint summarizer is close but not usable as-is: it asks for one 30-word sentence in
the UI language, while Source Control's message must be a Conventional Commit (AGENTS.md) with an
English `type(scope)` prefix.

**Decision.**

- **Same scope as the commit.** The generator uses `repo.staged.length > 0` — exactly
  `doCommit`'s test — so a message describes HEAD vs index when something is staged, otherwise
  index vs working tree. The diff composition moved out of `git-local.diff` into
  `composeDiff` (`ide/src/ai/git-common.ts`), shared with the generator: one renderer, the same
  `MAX_DIFF_CHARS`/`MAX_DIFF_FILES` caps, no second implementation to drift.
- **One bounded call.** `ide/src/ai/commit-generation.ts` takes `{ loadSettings, call, locale,
  contents }` (the `chat-session.ts` seams), reads the scope, caps the payload at 12 000
  characters and appends an explicit truncation marker, then makes exactly one non-streaming
  `callModel` with an `AbortSignal`. It resolves to `{ ok: true, message }` or `{ ok: false,
  failure }` and never throws; a signal aborted before the call returns `aborted` without
  spending it.
- **Conventional Commits, locale-aware.** `ide/src/ai/prompt-commit.ts` asks for
  `type(scope): summary`: imperative, no trailing period, body only when it adds information,
  no AI attribution or `Co-authored-by`, no invented ticket ids, no empty parentheses. The
  description follows the IDE locale (en/it); the prefix stays English. Normalization strips
  fences, leading prose and quotes, removes an empty scope and a trailing period, rejects empty
  output and caps the total length.
- **The message is text, not an operation.** `SourceControlCommitBox` (split out of the
  284-line `SourceControlRepoSection`) fills the textarea and stops there: success never
  commits, the generated text stays editable, and when the box already has text the replacement
  requires an explicit confirm click. Generation busy/failure states live on the control and
  inline; the control is disabled without a configured model, while `repo.busy`, when nothing
  changed, or while that repo generates. A second start aborts the first and only the latest
  result lands (`commit-box-state.ts` owns the controller and request id).

**Why this does not weaken D-181.** D-181 says AI **source writes** go through the validated
write tools and reuses the clean tree as the turn checkpoint. This call writes neither source nor
history: it reads HEAD/index/worktree and returns a string to a React textarea. Nothing reaches
disk or git; the only operation on the message is the user's own Commit click, through Source
Control's existing `doCommit`. The invariant's subject — automated source mutation — is
untouched, and the new path cannot apply a patch, stage, commit or push.

**Consequences.** A user can generate a message only on demand and only when a model is
configured; a failed or aborted call leaves the box exactly as the user left it and can be
retried. The panel now depends on the chat's provider settings, so configuring the chat enables
the control without a second settings surface. Because generation is opt-in per click, it adds no
cost to ordinary commits.

**Rejected alternatives.** *Auto-commit the generated message*: the message is a proposal, and a
commit is the user's consent over their own history. *Stream the answer into the box*: the call is
short and a partial message would be edited-away noise. *Reuse the checkpoint summarizer*: a
one-sentence, 30-word, non-Conventional summary fails this repository's convention and cannot
carry an English `type(scope)` in an Italian description. *A second diff renderer in the
generator*: it would drift from `git_diff` as soon as either cap changes. *Silently replace an
existing message*: the user's own text is never lost without a click.

**Verification.** `ide/src/ai/prompt-commit.test.ts` (prompt language/prefix, truncation warning,
fenced/prose/empty/over-long normalization), `ide/src/ai/commit-generation.test.ts` (staged ->
HEAD vs index, empty index -> index vs worktree, bounded payload + marker, unconfigured/empty/
throwing/aborted failures and no exception), `ide/src/components/ide/commit-box-state.test.ts`
(generation never commits, typed text needs confirmation, failure leaves the text, second start
aborts the first and only the latest lands), `ide/src/components/ide/SourceControlCommitBox.test.tsx`
(static labels, disabled states, inline failure and confirmation). Full gates: `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build`.
