# D-175 — The AI's web tool family is host-side and gated by the deployment's `network.connect`
**Status:** accepted (2026-11-12)

**Context.** The PTC runtime could read the project, the running preview, the project graph and the
repository (D-101/D-103/D-111/D-126/D-139), but not the web: a chat asked to use a current
library API, check a URL or bring an image/asset into the page had no path, and the sandbox is
networkless by design (D-101), so any web read has to happen on the host. The deployment profile
already owns what the page may reach — a managed build compiles `network.connect` into the CSP
`connect-src` (D-063, MANAGED-DEPLOYMENT §5) — so the new capability had to be a gate on that
same list, not a second policy.

**Decision.**

- Three host-side tools on the existing PTC seam, with no sandbox, protocol or runner change:
  `web_fetch({ url, maxChars? })` returns text (text/*, JSON and XML; HTML is reduced to text; at
  most 32k chars after secret redaction, response ≤ 1 MB); `web_image({ url })` fetches an image
  (≤ 5 MB) onto the D-112 image channel — shown to the user and sent to vision presets, at most 2
  per program; `web_download({ url, path })` saves any content type (≤ 5 MB) under `public/` only,
  overwrite allowed, at most 5 per program, and returns the file's SHA-256. A program may make 10
  web calls and move 8 MB in total; a call counts even when the read fails. `ide/src/deploy/web-policy.ts` maps the
  resolved deployment to the allowlist, `ide/src/ai/web-access.ts` performs the request,
  `ide/src/ai/ptc/web-tools.ts` registers the handlers and `ide/src/ai/ptc/web-text.ts` reduces
  HTML to text.
- Reach is the profile: `open` allows any HTTPS host (plain HTTP only on the IDE's own origin, for
  local development; its baseline CSP is `connect-src https:`); `managed` allows exactly the
  origins in `network.connect`, same-origin reads aside; a managed build with an empty
  `network.connect` advertises no web tool at all. The managed default is therefore no egress.
- Requests are GET with `credentials: "omit"` and no caller-supplied headers or body. The browser
  follows redirects, so the URL a redirect landed on is checked again against the same rule, and
  the body is capped while streaming, before decoding. Non-2xx statuses and non-text content types
  come back as data refusals (`{ ok: false, reason }`) instead of an exception.
- `web_download` validates the target with the shared policy: project-relative, no traversal or
  absolute path, under `public/`. Nothing else is writable.
- Text results run through the shared secret redaction; fetched content reaches the model quoted
  as data, never as instructions.

**Why.**

- The host is the only place the request can run: the sandbox has no network, and giving it one
  would dissolve the D-101 isolation that the rest of the tool surface relies on.
- Reusing `network.connect` keeps **one policy axis**. The list is already compiled into
  `connect-src`, so a tool cannot target a host the browser would block, and an operator who
  declares an origin for one feature makes it a candidate for reads too. An `ai.web` key would be a
  second allowlist to keep in sync with the CSP — exactly the drift this repository avoids by
  generating both from the same resolved config.
- `public/` only, because a downloaded file is an asset, not source. Source writes must stay the
  validated patch + the user's Apply (invariant 9, D-084/D-167); a binary cannot be parsed by the
  validator, so allowing it anywhere else would be a second, unvalidated source-write path (the
  reason D-126 keeps the graph and D-139 the repository index outside the patch path as well).
- Fail-closed by construction: the managed default is an empty list, so turning AI on does not by
  itself turn egress on.
- Fetched pages are attacker-controlled. Treating them as data (the MCP rule, D-118) keeps prompt
  injection at the D-066 boundary; the caps keep context size bounded and the redaction keeps
  secrets out of the provider call. CORS is deliberately *not* worked around: a host that does not
  send `Access-Control-Allow-Origin` cannot be read by any browser-only client, so a CORS, DNS or
  TLS failure is returned as a `network` refusal the model reports to the user — a real limit of a
  browser-only client, not a bug to fix with a proxy that would put a server back in the loop
  (D-063).

**Consequences.** The AI can look up current documentation and pull assets into a page; a managed
operator opts in by declaring origins, per build (one config, one origin, §3 of
MANAGED-DEPLOYMENT). The honest costs: every origin declared in `network.connect` — the registry
mirror, the git proxy, the providers — also becomes readable by the AI, because it is one list and
an origin an operator declares is an origin the page already trusts; CORS still refuses many
hosts, so the list is a maximum, not a guarantee; and web content enters the provider context,
bounded and redacted but still untrusted. No new capability flag and no skill capability:
`network: false` stays the skills default (AI-SKILLS §8.3/D-067), and a skill cannot fetch by
itself. Calls are traced like every other tool call (name, arguments, ok, bytes, duration).

**Verification.** The targeted IDE suites pass — `pnpm --filter @facilis.dev/ide exec vitest run`
on `web-policy.test.ts` (10), `web-access.test.ts` (11), `web-tools.test.ts` (19),
`vfs-write.test.ts` (4) and `prompt.test.ts` (24, including the web-section case): 68/68. They
cover the open/managed/empty gates, the plain-http and credential refusals, the redirected URL
re-check, the streamed cap, the `public/`-only download rule, the per-program budget and the
prompt section's presence only when a `web_` tool is advertised. The remaining gates (`typecheck`,
`lint`, the full `test` and `build`) are the PR's.
