# D-105 — Rule 1 uses the analyzer's oxc parser; validator outages are not repairs
**Status:** accepted (2026-11-07)

The user hit `[ts-parse] db/schema.ts: TypeScript syntax could not be checked: Timed out parsing
the patched file` on a real turn. Rule 1 was injected with Monaco's TypeScript language service —
a viewer feature (IntelliSense) that is re-created on cold projects and can hang — while every
other rule already reads the framework analyzer, the warm oxc-based worker that parses the same
files. The rejection also went through the repair loop, so the model was asked to fix a timeout
it could not fix, burning corrections and ending in a misleading "invalid patch set".

**Decision.**

- The IDE's rule-1 checker is `createAnalyzerSyntaxChecker()` (`ide/src/ai/analyzer-syntax.ts`):
  it runs `analyzeProjectFiles` on the patched file (a one-file map) in the analyzer worker and
  keeps only `parse-error` diagnostics. `ide/src/ai/monaco-syntax.ts` and its test are deleted;
  Monaco remains the editor's IntelliSense surface only, and `scripts/dev/smoke-intellisense.mjs`
  keeps testing that viewer feature. Node tooling keeps `@facilis.dev/ai/node` (rolldown/oxc), so
  rule 1 has one parser family in the browser and in Node.
- `ValidationError.infrastructure` marks findings about the validator's own plumbing: rule 1
  when the checker cannot answer, and `project-analysis` when the analyzer is down. The turn
  loop returns `ChatFailureKind "validator"` without a repair round; the chat shows "validator
  temporarily unavailable — retry in a moment" and writes nothing.
- No second browser parser: the analyzer is already required by every other rule, so a Monaco
  fallback would validate half the rules with a different parser.

**Rejected alternatives.** *Keep Monaco with more retries*: that was the 6×2.5 s loop that timed
out; a viewer service is the wrong dependency for a gate. *Fallback to Monaco only when the
analyzer is down*: the analyzer is required anyway, so the fallback would be partial. *Treat the
outage as a model repair*: the model cannot fix a worker.

**Consequences.** Rule 1 fails closed on the analyzer worker (the 30 s readiness/analysis budget
in `analyze-client.ts`); a one-file analyze per patched file is cheap on the warm worker. The
validator has one parser family and the chat no longer spends corrections on infrastructure
outages: a dead analyzer surfaces as a retryable validator error, not as a bad patch.

**Verification.** `analyzer-syntax.test.ts` (parse-error mapping, non-parse diagnostics ignored,
fail closed), `validator-context.test.ts` (infrastructure flag), `turn.test.ts` (no repair on
infrastructure), `chat-session-validation.test.ts` (validator kind), i18n parity; full gates
green.
