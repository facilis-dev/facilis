# D-111 — The AI can inspect and drive the running app (preview tools)
**Status:** accepted (2026-11-07)

The chat could only read the project's source. The failures that cost the user the most were at
runtime — "the upload doesn't work", a 500, a click that does nothing — and the model had no way
to see them, so every diagnosis was a round trip through the user's report.

**Decision.**

- The preview page already carries chobitsu (the CDP backend the preview Service Worker injects,
  `ide/public/sw.js`), and the DevTools panel relays it to chii. A programmatic client
  (`ide/src/vv/preview-cdp.ts`) now uses the same channel without opening DevTools: per preview
  tab it sends `Runtime.evaluate` (DOM reads, click, fill) after the bootstrap `init`
  handshake, and buffers `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` / `Network.*`
  events.
- The relay in `preview-devtools.ts` forwards every target message to that client (in addition to
  the DevTools frontend), keyed by the frame's tab; `PreviewSession` owns the client and exposes
  the active tab and route navigation (`navigatePreviewPath`).
- Eight PTC tools drive it (`ide/src/ai/ptc/preview-tools.ts`, with the AI-facing facade in
  `preview-access.ts`): `preview_state`, `preview_console`, `preview_network`,
  `preview_dom`, `preview_click`, `preview_fill`, `preview_open`, `preview_wait`. They are
  registered only when the host has a preview (the IDE always does); arguments are validated; with
  no running project they return `{ available: false }` as data so the model can ask for Run and
  retry.
- The prompt gains a "running app" section when a preview tool is registered: read
  `preview_console`/`preview_network` before proposing a fix when the failure is a runtime error
  or a failed request, reproduce a flow with click/fill, and never guess the runtime state.
- Safety: the tools act on the app's own data (they can create or delete rows) but never write the
  project; the only write path is still the validated patch set plus Apply (invariant 9).

**Rejected alternatives.** *A separate preview in an iframe we control*: the app under test is the
real preview (same SW, same Vite dev server, same HMR); a second renderer would prove a different
app. *CDP through a new dependency*: chobitsu is already injected; the client is ~280 lines.
*Screenshots now*: chobitsu can screencast through html2canvas, but the model still needs the
multimodal message format — that is the later slice.

**Consequences.** A runtime bug can be diagnosed from the app itself: console errors and failed
requests arrive as data, and a flow can be reproduced with clicks before the patch. The model
still cannot see pixels; a preview that is not running reports unavailable instead of failing the
program. Clicks mutate the app's dev data (not the project).

**Verification.** `preview-cdp.test.ts` (handshake, evaluate, console/network buffers, reload
cleanup, no-preview), `preview-tools.test.ts` (specs gated on the host, argument validation,
unavailable data), `prompt.test.ts` (the running-app section only with a preview tool), plus the
existing tool router suite; gates green.
