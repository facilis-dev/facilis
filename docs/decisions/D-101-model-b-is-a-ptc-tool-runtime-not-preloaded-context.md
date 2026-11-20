# D-101 — Model B is a PTC tool runtime, not preloaded context
**Status:** accepted (2026-11-07)

The user rejected the Model B strategy of passing project files in the prompt: it costs tokens on
large projects and cannot repair whole-file patches the model never saw (D-100's repair loop had
to inline the files as a stopgap). The chosen direction is PTC: the model writes one JavaScript
program per step; the IDE executes it in a sandbox against a read-only tool registry and returns
lossless JSON; the final answer is still the existing `AIResponse`, its patches validated by
§9.3 and written only by the user's Apply.

**Decision.**

- **Protocol (PTC pure):** one JSON object per turn, `script` XOR `patches`; the program is an
  async function body with `tools` as the only injected global; the run outcome (value or typed
  error) goes back as one user turn. Bounds: 6 script turns per message, 32 tool calls per
  program, 5 s wall, per-result and per-turn caps (D-108 later removed the counters; the wall
  clock and the size caps remain — the wall is 30 s since D-108's 2026-11-19 amendment,
  issue #43). No native function-calling mode in phase 1.
- **Sandbox:** sandboxed iframe (opaque origin) + one blob Worker per program; the iframe relays
  `{ id, tool, args }` to the IDE, which enforces path/secret/capability policy, caps and
  logging, and can drop the frame when the worker is unresponsive. The runner page is served
  with a CSP response header (`default-src 'none'`), not the Chrome-only `csp` attribute.
- **Read-only tools first:** list_files/read_file/search/get_schema/get_routes/get_config/
  get_manifest/get_i18n/get_project_summary. Patches remain the only write path.
- **`validate` tool:** the model can validate a candidate patch set with the same
  `validatePatch()` the final gate uses and fix the findings before its final answer. The final
  §9.3 gate stays mandatory (invariant 9); the goal is that it almost never fires, not that it
  is removed.
- **Extension seam:** MCP servers (remote Streamable HTTP, namespaced tools, explicit user
  enablement) and D-067 skill capabilities narrow the same registry.

**Evidence (phase 0 spike).** `spikes/ptc-sandbox/run.mjs`, Chromium 156.0.8078.47 headless with
COOP/COEP, 21/21 checks: the frame origin is `null` and the parent DOM, localStorage, IndexedDB
and OPFS are blocked; `fetch` is blocked; tool RPC and blob-Worker creation work in the opaque
frame; the worker inherits the restrictions and `terminate()` stops a busy loop; a 1.2 s busy
loop in the frame delayed the parent timer by 0 ms (isolated sandboxed iframes). The header-CSP
runner path was verified too. Only Chromium was exercised.

**Rejected alternatives.** *Preloaded file context* (the status quo, D-100 stopgap): does not
scale and cannot repair whole-file rewrites. *Native function calling only*: more round trips and
larger JSON than one program that can loop/aggregate. *Worker from a blob in the IDE origin*:
same-origin, so OPFS and storage stay reachable. *WebContainer process*: it is the app runtime
with project files and Node, not a trust boundary. *Removing the final validator*: it would break
invariant 9 — the `validate` tool makes it a pre-flight check, not a replacement.

**Consequences.** The phase-1 landing removes D-100's bounded inlined-file repair context (the
repair prompt points the model at `read_file` instead). Model A stays as the fallback until the
eval corpus shows the PTC path is at least as reliable. Cross-browser isolation and the managed
tool/server allowlist remain open (O-016, PTC.md §13).

**Verification.** `node spikes/ptc-sandbox/run.mjs` → 21/21. Phase-1 tests will cover the tool
policy, script runner, turn loop and the registry↔prompt parity.
