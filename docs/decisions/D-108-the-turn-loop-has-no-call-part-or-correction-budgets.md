# D-108 — The turn loop has no call, part or correction budgets
**Status:** accepted (2026-11-07)

The chat kept dead-ending on its own counters: a large request exhausted the 6-part budget
("The patch set needed more than 6 parts, so it was not completed"), exploration exhausted the
6-program budget, and a set that kept failing exhausted the 3-correction budget ("the assistant
could not produce a valid patch set"). Each was a hard stop before the model could finish. The
user's verdict: the counters are meaningless at this point — the only thing that matters is the
validity check.

**Decision.** Delete every conversation counter from the turn loop (`ide/src/ai/turn.ts`):

- no part quota: `MAX_PATCH_TURNS` is gone; a set may take as many parts as it needs (D-106's
  merge, salvage and continuation stay);
- no model-call backstop: `MAX_MODEL_CALLS` is gone;
- no exploration quota: `MAX_SCRIPT_TURNS` is gone; the model may run as many programs as it
  needs;
- no tool-call quotas: `MAX_TOOL_CALLS_PER_RUN`, `MAX_TOOL_CALLS_PER_TURN` and
  `PtcRunOptions.toolCallBudget` are gone;
- no correction quota: `MAX_REPAIR_ATTEMPTS` is gone (`repair.ts` still caps one report at 40
  findings and echoes at most 20 000 chars of the rejected answer — size caps, not counts).

The loop ends only on: the merged set passing the §9.3 validator, a provider/transport failure,
the user's Stop (abort), or a validator outage (an internal failure the model cannot fix, D-105).
The chat keeps numbering what it shows — `part N`, `attempt N`, program N — because numbering is
progress, not a budget: `ChatState.patchParts = { part }` and `ChatState.repair = { attempt }`,
and the i18n labels lost their `/{max}` placeholders.

**Kept, deliberately, because they bound resources rather than the conversation:** the sandbox's
per-program wall clock (`RUN_TIMEOUT_MS`, 30 s — raised from 5 s by the amendment below), the
program source cap (`MAX_PROGRAM_CHARS`,
16 KB), the run-result cap (`MAX_TOOL_RESULT_CHARS`, 64 KB), the trace-argument cap, and the
finding/echo caps above. The user's Stop button aborts the provider request and the sandbox.
`HISTORY_LIMIT = 20` in `chat-session.ts` stays too: it bounds how much conversation is
*replayed* on the next message, not how long the current turn may run.

**Amendment (2026-11-19, issue #43).** The wall clock is raised from 5 s to 30 s
(`RUN_TIMEOUT_MS = 30_000`). 5 s was sized for a program that calls one tool; the work a program
actually does — multi-file reads and searches on a cold VFS, a remote MCP call whose HTTP timeout
is 15 s (D-118) — legitimately outlives it, and the kill cost a full provider round trip per
retry. It remains a resource guard, not a quota: one fresh iframe per program, termination on
timeout, the caps above and the Stop button are unchanged. With 30 s, the MCP HTTP timeout is the
binding bound for a remote call again, so the prompt no longer asks for one call per program.
Verification: `ptc/runner.test.ts` (fake clock: a ~10 s program completes, >30 s times out),
`mcp/mcp-program-clock.test.ts` (an 8 s MCP call completes inside a program), `prompt-mcp.test.ts`.

**Rejected alternatives.** *A very high counter* (say 100 calls) produces the same dead end later;
the user asked for validity to be the gate, not a bigger number. *Applying a partial set when the
parts run out*: an incomplete set is not a project state (cross-file rules), and Apply is the only
write path. *A no-progress detector*: it is another count that can stop legitimate work; the model
already gets an explicit "none of these files is new" continuation line.

**Consequences.** A big feature — the attachment request that started this — completes without a
part quota, and a model that keeps producing invalid JSON keeps being corrected until the provider
context window or the user stops it: that error is the natural outer bound. The old failure
messages are gone with the counters. The prompt, the repair report and the continuation turn no
longer advertise a quota; they ask for as many complete files as fit in one answer.

**Verification.** `turn.test.ts` (ten exploration programs before the answer), `turn-parts.test.ts`
(nine parts in one set), `chat-session*.test.ts` (four corrections, parts progress, no dead end on
a rejected set), `repair.test.ts` (no attempt count in the report), `ptc/runner.test.ts` (every
tool call served), `prompt.test.ts` (no quotas advertised); i18n parity; full gates green.
