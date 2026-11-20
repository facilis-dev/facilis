# D-110 — The chat shows what the model is doing: reasoning and one activity row per call
**Status:** accepted (2026-11-07)

The user could not tell whether the assistant was thinking: the chat only showed the
exploration programs and the busy strip's elapsed seconds, and a provider round trip is silent
in between. The old per-call counters (D-108) had been the only visibility, and they were a dead
end, not insight.

**Decision.**

- **Reasoning stream.** `providers.ts` reads the visible reasoning each protocol exposes —
  OpenAI-compatible `delta.reasoning_content` (DeepSeek) or `delta.reasoning`
  (OpenRouter-style gateways), Anthropic `thinking_delta` — as `ProviderEvent.reasoning`,
  never mixed into `text`. `client.ts` streams it through `CallModelInput.onReasoning` and
  returns it as `CallModelResult.reasoning`; the JSON contract and the repair loop are
  untouched (reasoning is display data and is never replayed to the model).
- **Activity rows.** `turn.ts` reports every model call through `onCallStart`/`onCall` with a
  `ChatTraceCall`: number, duration, answer characters, reasoning characters, the provider's
  truncation flag and what the loop did with the answer (`script` | `part` | `answer` |
  `rejected` | `cut` | `failed`). The call row precedes the program row it asked for, so the
  timeline reads call → program → call.
- **State and UI.** `ChatState.trace` becomes `ChatActivity[]` (`ChatTraceCall | ChatTraceRun`,
  discriminated by `kind`); `ChatState.reasoning` holds the live stream of the current call.
  The call row is **inserted when the call starts** (`beginTraceCall`, outcome `running`) and
  completed **in place** (`completeTraceCall`), so the live reasoning streams inside that row
  and the timeline is strictly chronological: call → program → call. `ChatTraceView` opens the
  running row (its reasoning is what the user is watching), keeps finished rows collapsed with
  their reasoning behind them, and numbers programs separately. The wiring lives in
  `chat-turn-hooks.ts` because `chat-session.ts` is at the 300-line limit.
- **Caps are display caps:** 12 000 chars for the live block (tail) and 4 000 chars per stored
  call row. Nothing here is a budget; the loop's terminators are unchanged (D-108).

**Consequences.** A model that exposes its reasoning shows it while it works and keeps it in the
transcript; a model that does not (DeepSeek `deepseek-chat` today) still shows the call
timeline — duration, size, outcome — so the user can see whether the assistant is calling the
provider, exploring, sending parts or correcting. Reasoning is not replayed: the conversation
stays as small as before. In dev the seed model comes from `ide/.env`
(`VITE_DEEPSEEK_MODEL`); a reasoning model there is what makes the reasoning stream appear
inside the call rows.

**Verification.** `provider.test.ts` (the three reasoning fields), `client.test.ts` (streamed
separately from the text), `turn.test.ts` (one row per call, outcomes, reasoning forwarded),
`chat-session.test.ts` (live state + row), `chat-trace.test.ts` (union rows and caps), i18n
parity; full gates green.
