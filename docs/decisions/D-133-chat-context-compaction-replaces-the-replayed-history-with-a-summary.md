# D-133 — Chat context compaction replaces the replayed history with a summary
**Status:** accepted (2026-11-09)

O-018's owner decision (2026-11-07) defined "compact" as **context compaction**, not a density
toggle (CHAT-UX "Compact"). The chat replays only the last `HISTORY_LIMIT = 20` messages
(`chat-session.ts`), while the visible transcript survives far longer, so after twenty turns the
model silently loses the beginning of the conversation. Compaction is the user-triggered fix: it
changes the replay only, never the transcript.

**Decision.** `ChatSession.compact()` makes one plain-text model call with a fixed
`COMPACTION_SYSTEM` prompt (no tools, no PTC) whose answer becomes a `ChatSummary` —
`{ content, at, through }`, where `through` counts the transcript prefix it covers. It is a
header action (`chat.compact`, FoldVertical) enabled only when the chat is idle, a provider is
configured and the conversation has text; while it runs the chat is in a new `ChatPhase`
`"compacting"` so the composer is blocked and Stop aborts through the existing cancel path. A
provider failure (including an empty answer) surfaces as an ordinary `ChatFailure` and keeps the
previous summary.

- **Replay.** `send()` calls `replayWithSummary(messages, summary, HISTORY_LIMIT)`: with a
  summary, the model gets it as one user turn followed only by the messages after `through`,
  still capped at 20; without one, the old `replayTurns` path is unchanged. A second compaction
  feeds the previous summary plus the newer messages and moves the coverage.
- **Transcript.** The covered messages stay visible; a dashed `ChatSummaryView` row after the last
  covered message expands to the exact summary. `newChat()` clears the summary with the rest of
  the state.
- **Guards and cost.** The button is disabled when the current summary already covers the whole
  transcript, and `compact()` re-checks that there is new text (one extra provider call per real
  compaction). The compaction call reads the whole covered transcript (or summary + newer
  messages), so a conversation larger than the provider window surfaces the provider failure
  rather than dropping context silently.

**Why a new module.** `chat-session.ts` was at the 300-line limit: the prompt, summary shape and
replay preparation live in `ide/src/ai/chat-compaction.ts`. The streamed-bubble bookkeeping moved
out to `ChatStreamWriter` in `chat-stream.ts` (behaviour unchanged; `StreamAccumulator` still
throttles the paint) so the session had room for the action. The composer needed no change:
`busy = phase !== "idle"` already disables it and swaps Send for Stop.

**Rejected.** A slash-command parser in the composer (the header button is the same command with
no extra state); automatic compaction on a threshold (silent model calls cost money and the user
must see when the context was replaced); persisting the summary (the chat is in-memory and the
transcript is not persisted either); removing the covered messages from the transcript (the
visible history is the user's audit trail; only the model replay changes).

**Consequences.** After compaction the model's history is one summary plus up to 20 newer turns;
the marker's count is the covered prefix size. The transcript can grow without bound (as before),
so compaction is repeatable: each run replaces the replay, not the visible history.

**Verification.** `chat-compaction.test.ts` (10 tests: success and replay swap, second compaction,
provider failure keeps the previous summary, empty answer, busy/cancel, no conversation, no
provider, no re-summarizing an already-covered transcript, replay cap, and the no-summary
delegation to `replayTurns`); the IDE suite is 122 files / 991 tests and root `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build` are green. The button and marker row have no browser
pass yet — theme, i18n parity and typecheck cover the static rules.
