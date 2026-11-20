# D-138 — The chat transcript is strictly chronological: a turn's activity sits between its question and its answer
**Status:** accepted (2026-11-10)

The owner reported that the assistant's answer appeared **above** the tool executions of the turn
that produced it: "mi risponde con il messaggio sopra le esecuzioni ... non c'è tanto la linearità
del tempo". The cause was structural, not cosmetic. `ChatPanel` rendered `ChatState.trace` — the
current turn's model-call and program rows — once, after the whole `messages` list, while the
turn's answer is appended to `messages` (so it rendered above those rows). `TURN_RESET` cleared
the trace at every new send, so a finished turn's activity was never persisted and vanished from
the transcript on the next message. And because only the first provider call streams
(`turn.ts`), an exploration turn kept its streamed prose bubble while its program ran, so that
narration also sat above the program row it introduced.

**Decision.**

- `ChatMessage.activity` carries the `ChatActivity[]` of the turn that followed a message and is
  set on the **user** message when the turn ends — success, failure or cancel (`turnEnded` in
  `chat-session-types.ts`). `ChatState.trace` remains the **live** turn only and is cleared when
  its activity moves, so the two never double-render.
- `transcriptEntries(state)` (`ide/src/ai/transcript-entries.ts`, pure and React-free) builds the
  ordered transcript: each message, then its persisted activity; the live activity after the user
  message that opened the turn and **before** a trailing streaming answer bubble; the compaction
  marker after the activity of the last covered message. `ChatTranscriptView` maps the entries to
  `ChatMessageView`/`ChatTraceView`/`ChatSummaryView` 1:1.
- Only the turn's final answer is transcript prose. When a model call turns out to be an
  exploration program, `turnHooks.onScriptStart` drops its streamed bubble: the call row records
  the call and the program row shows what it did, so the prose cannot outlive its step.
- A finished turn's rows stay collapsed (`live={false}`: the newest call row only stays open in
  the live turn), so the history reads as a dense timeline rather than a stack of open cards.
- No new user-facing strings: the existing `chat.trace.*` keys are reused; the ordering is
  display state and is never replayed to the model (`activity` is ignored by `replayTurns`).

**Consequences.** A turn reads question → activity → answer in every state, and that order
survives later turns; a failed or aborted turn keeps its rows too. D-110's row order and
reasoning-inside-the-running-call-row behaviour are unchanged, and compaction keeps working
(`ChatSummary` still replaces a message prefix for replay; the marker just follows the covered
messages' activity). No provider, prompt or validator change.

**Rejected.** Keeping one global trace block with `order` metadata (still loses a turn's rows and
needs a merge in the renderer); moving the activity into the assistant message (it would render
above the answer again, or require the answer bubble to be split from its turn); a card per turn
(D-114's lighter transcript direction).

**Verification.** `transcript-entries.test.ts` (streaming turn, finished turn, two turns, failed
turn, summary marker, live activity before the streaming bubble), `chat-session` tests (activity
persisted on the user message and cleared from `trace`; failed turn keeps it), focused IDE
vitest, typecheck and the file-length gate.
