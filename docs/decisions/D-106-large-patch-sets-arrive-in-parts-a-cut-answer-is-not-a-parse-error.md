# D-106 — Large patch sets arrive in parts; a cut answer is not a parse error
**Status:** accepted (2026-11-07)

A real turn — "add attachments (upload, preview, download) to the todo app" — produced a ~28 KB
answer that the provider cut at its output limit. The cut landed right after a complete patch
object, so the JSON ended mid-array: `JSON.parse` failed with `Expected ',' or ']' after array
element in JSON at position 28469`, the chat showed that raw error, and the repair loop asked the
model to resend the whole set — which the same limit cut again, until the three corrections were
gone. The user saw "the assistant could not produce a valid patch set" for a request that was
just too large for one answer.

**Decision.**

- The client surfaces the provider's stop reason (`finish_reason: "length"` /
  `stop_reason: "max_tokens"`) as `CallModelResult.truncated` (`ide/src/ai/client.ts`); when a
  stream carries no stop reason, the parser marks a JSON error at the end of the text as
  truncated too (`ide/src/ai/response.ts`).
- The model may split a set: every part is a complete `AIResponse`, and `"continue": true` marks
  every part but the last. `ide/src/ai/turn.ts` merges the parts by path (a later part may correct
  a file), ORs `requires_confirmation`, keeps the notes and validates the merged set once
  (`ide/src/ai/patch-set.ts`); the chat shows "sending the patch set in parts (n)". The part
  count is informational only: D-108 removed the per-answer part quota, so the loop keeps asking
  until a last part arrives; a part without patches still needs a message.
- A correction **keeps the rejected set** (`beginCorrection` in `patch-set.ts`): the model re-emits
  only the files the findings name, files it omits keep their rejected patch, and `"delete"` drops
  one. This is what keeps a correction cheap: a fix to two files of a three-part set is one answer,
  not another three parts.
- A part that only repeats files already received gets an explicit continuation line instead of
  silently spending calls. (D-106 originally also capped the turn at 22 model calls and 6 parts;
  D-108 deleted every counter.)
- A cut answer is not thrown away: `ide/src/ai/salvage.ts` scans the `patches` array with a
  string-aware brace scan and keeps the complete patch objects before the cut; the turn asks for
  the rest with the list of files already received (their content is not re-sent). If no complete
  patch survives, the repair report gains a "## The answer was cut off" section with the part
  protocol instead of only the raw JSON error.
- The system prompt, the repair contract and the new large-set guidance tell the model to keep an
  answer under the output limit and send as many complete files as fit (usually 2–4).

**Rejected alternatives.** *Raise `max_tokens`*: provider- and model-dependent (Anthropic
rejects values above the model's limit) and the set already exceeds a conservative cap. *Retry
the same answer after cutting it*: the tail is lost and the next attempt has the same budget.
*Validate each part separately*: the §9.3 rules are cross-file, so a part would false-positive;
the merged set is validated once, exactly like a one-answer set.

**Consequences.** A feature spanning more than one answer completes; a cut answer keeps its work
and asks for the remainder; a genuinely malformed answer still gets the ordinary repair (now with
the part advice), with the raw JSON error as detail only. The conversation stays bounded: each
part is recorded as a synthetic assistant turn listing its paths, not the raw part content, which
would push the next request over the context window. A correction is usually a single call
because it merges, so the common large-feature turn costs one exploration pass, two or three parts
and one correction; with the part quota gone (D-108) the number of parts is whatever the set needs.

**Verification.** `salvage.test.ts` (cut tail, brace inside content, missing separator, malformed
element), `response.test.ts` (continue contract, truncation detection), `turn-parts.test.ts`
(merge, a correction that re-emits one file, salvage continuation, a nine-part set),
`chat-session-repair.test.ts` (part progress in the chat state),
`client.test.ts`/`provider.test.ts` (stop reasons); full gates green.
