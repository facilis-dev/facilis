# D-045 — The AI chat is BYO-key, direct from the browser, with provider presets
**Status:** accepted (2026-10-31)

The Studio needs its AI chat (SPEC §10.2, Phase 4). The spec fixes the shape — the user's own
key, requests going straight from the browser to the provider, no Facilis inference bill — but
not the provider surface, where the key lives, or how the panel is wired into an imperative
controller.

**Providers.** `ide/src/ai/providers.ts` describes two wire protocols (OpenAI-compatible
`/chat/completions` SSE and Anthropic `/v1/messages` SSE) and gives each a preset: Anthropic,
OpenAI, OpenRouter, DeepSeek and Custom (any OpenAI-compatible base URL, so a local or proxied
endpoint works). A model name is free text with an editable per-preset default, and switching
provider clears the key field: a key is provider-specific and must never be sent to another
host by accident. O-007 is resolved by this: no single model is enforced; the presets document
what was tested.

**The key** is stored in `localStorage` (`vv-ai-settings`, per origin like the git identity and
the recent-projects registry), never in the repository, never in the VFS, never in a prompt,
and never anywhere except the chosen provider's own auth header. It is not encrypted at rest:
a key the panel must re-read at every boot can only be obfuscated by keeping its own
decryption secret beside it. PATs, which are read rarely and can prompt, get real encryption
when Phase 2 adds git auth. `ChatSettingsDialog` says where the key lives and the provider
hint says where to create it.

**Direct calls have one consequence:** the provider must allow browser origins. OpenRouter and
Anthropic (with `anthropic-dangerous-direct-browser-access: true`) do; a provider that does not
surfaces as the network-error card, which names CORS, and Custom is the escape hatch (local
server or own proxy). No Facilis server is introduced — SPEC §3 keeps the Studio a static SPA.

**Wiring.** `ChatSession` (`ide/src/ai/chat-session.ts`) owns the conversation and talks to the
editor through `ChatHost` (`files`, `read`, `activeFile`, `manifestBase`, `openFile`, `bridge`)
and to the model through an injected `call`, so the session is unit-tested with a fake host and
fake answers. `chat-host.ts` builds the host from `IdeController` and keeps one session per
controller in a WeakMap, so switching sidebar views keeps the conversation. The React surface is
a new activity view (`activeView: "chat"`), `ChatPanel` plus three small views, and a command
palette entry.

**Dev-only mock.** `callModel` dispatches "mock" to `ide/src/ai/mock.ts`, which answers with a
canned `AIResponse`; the preset is listed only when `import.meta.env.DEV`, and the client refuses
it otherwise, so a production build cannot select it. It makes the whole flow demonstrable
without a key and lets `pnpm ide:smoke` drive the real UI end to end (D-046).

**Consequences:** adding a provider is a preset entry (plus a protocol if its wire format is
new); tests never need network access; the browser, not a server, is the trust boundary for the
key, which is exactly what the BYO-key model promises.
