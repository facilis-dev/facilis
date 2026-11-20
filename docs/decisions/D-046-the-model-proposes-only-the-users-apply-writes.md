# D-046 — The model proposes; only the user's Apply writes
**Status:** accepted (2026-10-31)

SPEC §9.1/§9.3 make the model's output an `AIResponse` that a validator gates before anything
touches disk (security invariant 9). The panel must therefore never apply a turn implicitly, and
the write path must be the one already verified in the WebContainer (`applyPatch`, D-025).

**Flow.** A turn is sent with the project as context (Model A: full manifest when the project is
running, the file list, the open buffer including unsaved edits, and `facilis.config.ts`; the
prompt is bounded and says so when it truncates). The answer must be one JSON object:
`{ message, patches[], notes[], requires_confirmation }`; a fenced block is tolerated, prose
around it is not. `parseAiResponse` rejects anything unusable and reports the parser/validator
output in the chat instead of guessing.

**Review.** A parsed answer with patches becomes a proposal: per file, the before-image is read
from the project, `fileDiff` renders a unified diff with three lines of context (capped at 400
rendered lines per file — a UI budget, not a security limit), and every file is accepted by
default but can be unchecked. Apply sends **only the accepted patches** through
`applyPatch()`, which re-validates them (`@facilis.dev/ai`) and writes through the kernel bridge —
never OPFS — then refreshes the framework revision. Failures are reported per file; a partially
applied patch is shown as such and is not retried blindly. `requires_confirmation` is surfaced as
a banner on destructive turns; it is not yet a blocking modal.

**Scope now vs Phase 4.** Only the structural validator rules (`file-path-allowed`,
`content-present`) are enforced today. The other 14 SPEC §9.3 rules need a TypeScript program,
the manifest and the O-009 path allowlist; they land in `@facilis.dev/ai` and are called from the
same `parseAiResponse`/`applyPatch` seam. At the time the SPEC §9.4 retry loop was not
implemented: a failure was reported in the chat and the user re-asked (implemented later,
D-100). Neither gap weakens invariant 9 — the model still writes nothing on its own.

**Verification.** `chat-session.test.ts` proves a turn yields a proposal with no bridge writes and
that Apply writes only accepted files; `chat-proposal.test.ts` covers create/update/delete diffs;
the smoke opens the real panel, configures the dev mock, sends, reviews and applies, then reads
the written file back from the VFS (`scripts/dev/smoke-chat.mjs`).

**Consequences:** per-file accept/reject and the proposal card are in place before the full
validator, so the remaining Phase 4 work plugs into a tested seam; the mock provider keeps CI
honest without a key.
