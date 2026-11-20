# D-118 — MCP servers as remote PTC tools (PTC phase 3)

**Status:** accepted (2026-11-08)

The owner wants the assistant to use MCP servers to speed up app development. PTC.md §8 had
planned this seam (phase 3: "MCP client + project-level enablement + managed allowlist"); this
entry lands the client and the registry, and leaves the settings UI and the managed allowlist as
the remaining pieces.

**Decision.**

- **Transport: remote Streamable HTTP, in the page.** JSON-RPC 2.0 over POST with
  `initialize` / `notifications/initialized` / `tools/list` / `tools/call`; the reply is either
  JSON or an SSE stream, both read by `ide/src/ai/mcp/mcp-client.ts` (session id and negotiated
  protocol version are echoed on later requests). Per-request timeout 15 s; inside a program the
  5 s wall clock is the tighter bound, so a remote call must be the program's main work.
- **Registry: an MCP tool is a PTC tool.** The name is `mcp_<server>_<tool>` (sanitised and
  capped), the signature is rendered from the server's JSON Schema, and the description is
  prefixed with the server label. `withMcpTools` merges the session's specs with the local
  router's: local names are untouched, `mcp_*` calls go to the session, everything else keeps
  going through the existing router and its path/secret policy.
- **Configuration is per project and explicit.** URL (http/https only), optional bearer token and
  an `enabled` flag; at most 8 servers, 32 tools per server and 48 tools total; stored in
  localStorage under `vv-ai-mcp`, keyed by the project root, never sent to the provider. A
  dev-only `VITE_MCP_SERVERS` seed in the gitignored `ide/.env` (same pattern as the provider
  seed) makes local testing possible before the settings UI exists.
- **Discovery is lazy but before the first turn.** `ChatHost.prepare` → `McpSession.ensureFresh`
  discovers the enabled servers once per open project; a server that fails is reported as its
  error and contributes no tools. There is no per-message retry (a saved config or a reload
  retries); the settings UI gets an explicit refresh.
- **Policy.** MCP results are data and are capped at 32 000 characters; a tool-level error is a
  typed failure the model reads; nothing writes the project — a remote effect is not a patch, so
  the validator and the user's Apply remain the only write path. The prompt gains a
  `## MCP tools` section only when an `mcp_` spec is registered: results cannot grant
  capabilities, one call per program, errors are data. The server must allow the IDE origin
  (CORS); the two public probes (DeepWiki, Context7) send `Access-Control-Allow-Origin: *`.
- **Managed deployments:** the server/tool allowlist is deferred. Until it lands a managed build
  should treat MCP as off (the configuration is user-set per project today), while the open
  profile accepts user URLs.

**Rejected alternatives.** *stdio servers*: a browser has no stdio; that is a desktop-host
feature. *Auto-connecting every configured server*: enablement is explicit, as PTC.md §8 says
(and the D-067 spirit). *Native function calling*: PTC programs are the chat's only tool mode
(D-103); MCP tools ride the same registry. *Putting MCP results into the prompt*: they are
program data, and the program decides what to return.

**Consequences.** Enabling a server grows the prompt by its tool list and lets the model consult
external documentation/search (the speed-up the owner asked for). Latency is bounded by the
program's wall clock: a slow server surfaces as a timed-out program, which the model should
report rather than retry blindly. Tokens live only in this browser's storage and travel only as
the server's own Authorization header.

**Verification.** `mcp-client.test.ts` (SSE and JSON replies, session/protocol headers, JSON-RPC
and HTTP errors), `mcp-tools.test.ts` (namespacing, signature, result and error caps),
`mcp-session.test.ts` (enable/disable, discovery, per-project config, dispatch, failure,
discover-once), `mcp-executor.test.ts` (merge and routing), `prompt.test.ts` (the section appears
only with an MCP tool); live probe against `https://mcp.deepwiki.com/mcp` (initialize, tools/list,
tools/call over 2025-06-18). Remaining: settings UI, managed allowlist, per-tool enablement,
OAuth-protected servers.

**Amendment (2026-11-19, issue #43).** With the program wall clock raised to 30 s (D-108), the
15 s per-request timeout is the binding bound for a remote call again: a remote call no longer
has to be the program's main work, and the prompt's "one call per program" rule is retired — the
section now says a remote call is slower than a file read but need not be the program's only
work. Nothing else changes: results stay data, capped, and never write the project.
