# D-047 — The chat streams the message field, warns at the browser boundary, and can undo an apply
**Status:** accepted (2026-10-31)

Three gaps showed up in the first real session with the chat: a turn sat silent until the whole
`AIResponse` arrived; an applied patch could put Node-only code in client files and break the
preview with `Uncaught ReferenceError: process is not defined`; and Apply had no way back.

**Streaming.** The contract stays SPEC §9.2: the model answers with one JSON object, so streaming
the raw bytes would show JSON. `ide/src/ai/stream-message.ts` walks the growing prefix as a JSON
tokenizer (string/escape state, brace depth) and returns the decoded value of the top-level
`message` field, partial but readable; a "message" inside a patch body never matches. ChatSession
renders that prefix in the assistant bubble with a caret, throttling store emits to ~30 ms so the
panel does not re-render per token, and replaces it with the parsed `message` when the answer
finishes. Nothing is parsed early: the full response still goes through `parseAiResponse` and the
proposal is built from it. The dev mock now trickles its canned answer through `onText` as well,
so the streaming path is demonstrable and tested without a provider.

**Browser boundary.** The generated project has two runtimes in one tree: `src/` and
`components/` are the browser; `server/` is Nitro in the VM. The model had no rule for that, so
`process.env` or a server-only import in a client file compiled and then killed the preview. Two
guards: the system prompt gains rules 10-11 (no Node globals or server-only imports in client code;
use `import.meta.env`, call `/api/...`; `process.env` only in `server/`), and the review card
runs `scanPatchWarnings` (`ide/src/ai/patch-warnings.ts`) over `src/` and `components/`
patches, listing Node globals and server-only specifiers as non-blocking warnings under a
`warning` role. Warnings never prevent Apply: the user decides.

**Undo.** A proposal already read every before-image to render its diff; those are now kept and,
for the files that actually landed, stored as an undo plan. `chat-actions.ts` turns that plan back
into patches (a created file becomes a forced delete, an updated or deleted file is rewritten with
its previous content) and writes them through the same validated `applyPatch` path. The applied
card offers Undo until the plan is consumed; a new turn clears it. A partial apply is only undoable
for the files that landed, and a failed undo keeps the plan so it can be retried.

**Verification.** `stream-message.test.ts` and `patch-warnings.test.ts` cover the extractor and
the scanner; `chat-session.test.ts` asserts the partial bubble, the dropped bubble on a parse
failure, the undo plan, and that Undo deletes a created file; `chat-proposal.test.ts` covers the
warnings. The smoke applies the mock patch, reads it from the VFS, clicks Undo, and asserts the file
is gone again (`scripts/dev/smoke-chat.mjs`).

**Consequences:** the chat feels live without weakening the one-object contract; the boundary class
of mistake is caught at review time instead of breaking the preview; and an Apply is reversible
without git. The full 16-rule validator and the SPEC §9.4 retry loop were still Phase 4 at
the time (later implemented: D-084 and D-100; D-046).
