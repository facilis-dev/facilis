# PTC tool runtime (Model B) — design proposal

**Status:** accepted (2026-11-07, **D-101**) and now the chat's **only mode** (**D-103**). The
phase-0 isolation spike ([`spikes/ptc-sandbox/`](../spikes/ptc-sandbox/README.md)) passed 21/21
checks in Chromium 156; the phase-1 chain and the exploration trace UI landed; the eval corpus
and the browser matrix remain. Related: [`SPEC.md`](./SPEC.md) §9.1/§9.4/§9.5,
[`AI-SKILLS.md`](./AI-SKILLS.md) §6–§8 (D-066, D-067), D-045/D-046 (chat), D-084 (validator),
D-100 (repair loop), D-102 (repair hardening).

## Accepted decisions (2026-11-07)

- **PTC pure and single-mode.** The model writes one JavaScript program per step; there is no
  native function-calling mode in phase 1 (an adapter can be layered on the same registry later),
  and there is no non-PTC chat fallback (D-103: always on, no dev flag).
- **Sandbox.** Sandboxed iframe (opaque origin) + one blob Worker per program + parent-side
  tool RPC. The runner page is served with a **CSP response header** (cross-browser), not the
  Chrome-only `csp=""` attribute.
- **Spike first.** Phase 0 proved isolation, RPC, worker termination and parent responsiveness
  before any tool work (results in §5).
- **`validate` tool.** The model can run the 16-rule validator on candidate patches before its
  final answer. The final §9.3 gate **stays mandatory** (invariant 9): the goal is that the
  model self-checks and the user almost never sees a final validation failure, not removing the
  safety net.

**One line:** the model stops receiving the project as preloaded context and instead writes a
small JavaScript program per step; the IDE executes that program in a locked sandbox against a
read-only tool registry (files, analyzer facts, manifest, later MCP servers), returns lossless
JSON to the model, and only the final answer of the conversation becomes an `AIResponse` whose
patches still go through the 16-rule validator and the user's Apply.

---

## 1. Why this change

Model A (SPEC §9.1: full manifest + file list + config + active buffer preloaded) is cheap for a
small project and wrong for a large one:

- **Cost.** Every turn pays for context the model does not need. A large project cannot be
  preloaded at all; the current caps truncate it silently.
- **Correctness.** `create`/`update` patches carry the **complete file**, but the prompt only
  contains the active file and `facilis.config.ts`. A model asked to add a field to
  `db/schema.ts` while `src/App.tsx` is open cannot see the schema; it guesses, drops existing
  tables/routes, and the validator rejects the patch (the screenshot failure: *"the patch drops
  table todos"*). D-100's repair loop fixed the dead end, but it had to embed the current file
  content in the repair message — exactly the prompt-stuffing this proposal removes.
- **Exploration.** Diagnosing a real change needs *search + read + facts*: "where is this route
  registered?", "which page calls this API?", "is this table scoped?". Those are queries, not
  prose the model should have to be handed.
- **Extensibility.** A tool registry is also the seam for MCP servers and for skill-scoped
  capabilities (D-067), without changing the model contract a third time.

The user's direction (2026-11-07): **PTC mode — the AI writes JavaScript, we run it.** This is the
same execution seam DSH uses for its own `run_code` tool: one program per step, host-provided
async bindings, lossless-JSON results, size/time guards, failure as data.

## 2. Non-goals (phase 1)

- No shell, no network from program code, no writes from program code.
- Patches are still proposed as `AIResponse.patches` and written only by the user's Apply
  (invariant 9); exploration can never touch the VFS.
- No server-side execution: the IDE is a static SPA; git and files are in the browser/WebContainer.
- No MCP or skills in phase 1; the design keeps the seam.
- No replacement of the validator: tools change *how the model learns*, not *what is written*.

## 3. Architecture

    user message
        │
        ▼
    ChatSession ──► TurnLoop (script? / final answer?)
        │                 │  provider call (existing client.ts)
        │                 ▼
        │            ScriptEnvelope  ──► ScriptRunner (sandboxed iframe, opaque origin)
        │                 │                    │ postMessage RPC (lossless JSON only)
        │                 │                    ▼
        │                 │              ToolRouter ──► VFS read (kernel, project-root confined)
        │                 │                    │      ├► @facilis/analyze facts (schema/routes/graph)
        │                 │                    │      ├► /__facilis/manifest client
        │                 │                    │      └► (phase 3) MCP client
        │                 │                    │
        │                 │                    └► policy: path/glob allowlist, secret redaction,
        │                 │                       skill capability narrowing, result caps, audit log
        │                 ▼
        └── final `AIResponse` (status quo) ──► parseTurn() §9.3 validator ──► proposal ──► user Apply

New modules (planned, all under `ide/src/ai/ptc/`):

| Module | Role |
|---|---|
| `sandbox.ts` | creates/locks the iframe, owns the RPC, timeouts, termination |
| `sandbox-frame.ts` | the in-iframe bootstrap (the only code that runs in the opaque realm) |
| `script-runner.ts` | runs one program against the router, maps outcomes to the wire result |
| `tools/registry.ts` | tool definitions: name, JSON-schema-ish signature, handler, caps |
| `tools/policy.ts` | one path/secret/capability policy shared by context and tools |
| `tools/vfs.ts`, `tools/analyzer.ts`, `tools/manifest.ts` | adapters over existing IDE seams |
| `prompt-tools.ts` | generates the system-prompt tool section from the registry |
| `trace.ts` | the per-turn exploration trace the UI renders |

## 4. Wire protocol (one JSON object per model turn)

Two mutually exclusive shapes, both inside the existing one-object contract:

Exploration turn:

    {
      "message": "Let me read the schema and the todos route.",
      "script": "const files = await tools.list_files({ dir: 'server/routes/api/todos' });\nconst schema = await tools.read_file({ path: 'db/schema.ts' });\nreturn { files, schema };",
      "notes": [],
      "requires_confirmation": false
    }

Final turn: the current `AIResponse` with `patches` (unchanged).

- The program is an **async function body**: top-level `await` and `return` are allowed, `tools`
  is the only injected global. The return value must be lossless JSON.
- The IDE appends the run outcome to the conversation as one `user` turn, natively typed:

      { "ok": true, "value": <returned JSON> }
      { "ok": false, "error": { "kind": "exception|timeout|abort|output-limit|protocol|sandbox-unavailable", "message": "..." } }

  The model can recover inside the loop; a bad program is data, not a dead end.
- **Bounds:** no conversation quotas (D-108) — there is no program, tool-call or part counter, so
  the model explores until it has what it needs. Resource guards remain: one program ≤ 16 KB
  source, 5 s wall clock, one run result ≤ 64 KB (and its trace args are capped). Cancellation
  aborts the provider request and the sandbox.
- **Why not native function calling (OpenAI/Anthropic `tools`)?** The user asked for PTC and it
  is the better fit: one program can loop, join, filter and aggregate, so N reads cost one round
  trip instead of N, and the JSON is smaller. A native-tool "Mode C" can be layered on the same
  registry later without changing tools or policy.

## 5. Sandbox

The program is **untrusted code**. Options considered:

| Substrate | Isolation | Verdict |
|---|---|---|
| Sandboxed iframe, `srcdoc`/`blob:` + `sandbox="allow-scripts"`, CSP attribute `default-src 'none'` | opaque origin: no parent DOM, no OPFS/localStorage/IndexedDB of the IDE origin, no network; only `postMessage` to the parent, which is the tool RPC | **recommended** |
| Worker from a blob URL | same origin: OPFS and storage are reachable by the script | rejected |
| WebContainer process | project files and Node reachable; heavy; it is the app runtime, not a trust boundary | rejected for programs; reserved for phase-2 `run_check` |
| SES / ShadowRealm | not portable/available across the target browsers today | deferred |
| Server-side sandbox | there is no server in the open IDE; managed could add one later | out of scope |

**Phase-0 evidence (2026-11-07).** `spikes/ptc-sandbox` (Chromium 156, COOP/COEP, 21/21):
the frame origin is `null`; parent DOM, localStorage, IndexedDB and OPFS are blocked; `fetch`
is blocked; the tool RPC and blob-Worker creation work inside the opaque frame; the worker
inherits the restrictions and `terminate()` stops a busy loop; a 1.2 s busy loop in the frame
delayed the parent timer by 0 ms (Chromium's isolated sandboxed iframes). The header-CSP runner
was verified as well. Cross-browser (Firefox/Safari) remains a phase-1 gate, and process
isolation is a bonus: `terminate()` is the contract, not the process boundary.
**Architecture settled by the spike:** the program runs in the worker inside the opaque iframe;
the iframe relays only `{ id, tool, args }` to the parent; the parent enforces the policy and
can drop the whole frame when the worker is unresponsive.

Rules for the sandbox host:

- The iframe gets **no origin privileges**: no `allow-same-origin`, no popups, no forms, no
  downloads, no top navigation.
- The parent answers only `{ id, tool, args }` requests for tools in the current allowlist; every
  answer is re-validated, capped and redacted on the parent side. Unknown/denied calls return a
  typed error, never throw into the host.
- Timeouts terminate the iframe (a fresh one per program); a program cannot retain state or
  escape by keeping timers alive.
- `postMessage` payloads are structured-cloned; both sides validate shapes; no functions, no
  prototypes, no objects with getters cross the boundary.
- **Spike required** (phase 0): verify opaque origin + CSP behavior under the IDE's COOP/COEP and
  the WebContainer preview, memory/CPU bomb termination, and that the iframe cannot read the
  kernel/OPFS. This is the one assumption worth proving before building the tool layer.

## 6. Tool registry (phase 1: read-only)

The tool set is a primitive, validated, logged API (AI-SKILLS §7). All paths are project-relative,
confined to the project root, and go through one policy function.

| Tool | Arguments | Returns (caps) |
|---|---|---|
| `list_files` | `{ dir?, glob? }` | project-relative paths (≤ 500) |
| `read_file` | `{ path, startLine?, endLine? }` | content (≤ 400 lines / ≤ 32 KB) |
| `search` | `{ query, glob?, maxResults? }` | `[{ path, line, preview }]` (≤ 100) |
| `get_schema` | `{ table? }` | analyzer `TableFact` summary: columns, scope, RLS, source |
| `get_routes` | `{ prefix? }` | route facts: method, path, dbTables, permission, source |
| `get_config` | `{}` | parsed `facilis.config.ts` facts (permissions, roles, tenant/owner columns) |
| `get_manifest` | `{}` | live manifest summary (blocks, revision) — no secrets |
| `get_i18n` | `{ locale? }` | catalogue keys + values (cap) |
| `get_project_summary` | `{}` | counts by area + top-level names (cheap orientation) |
| `validate` | `{ patches }` | the same `validatePatch()` findings the final gate uses (SPEC §9.3); read-only, writes nothing |
| `preview_state` | `{}` | running app: URL, title, viewport, visible text (D-111) |
| `preview_console` | `{}` | recent console errors/warnings and uncaught exceptions |
| `preview_network` | `{}` | recent failed or non-2xx requests |
| `preview_dom` | `{ selector?, maxChars? }` | element HTML, or the body text |
| `preview_click` | `{ selector }` | clicks an element (reproduces a user flow) |
| `preview_fill` | `{ selector, text }` | types into an input/textarea (input/change) |
| `preview_open` | `{ path }` | navigates the preview to a route (reloads) |
| `preview_wait` | `{ selector?, ms? }` | waits for an element or a delay |
| `preview_screenshot` | `{}` | JPEG of the page (html2canvas): shown to the user, sent to vision models (D-112) |

**The `validate` tool is the model's self-check.** The model can assemble a candidate patch set,
validate it, fix every finding and only then emit the final `AIResponse`. The final §9.3
validation and the user's Apply stay in place (invariant 9); with the pre-flight tool the final
gate should almost never fire, so the red "invalid patch set" flow disappears from normal use
while the safety net remains. The tool must call the same pure function as the final gate —
never a second implementation of the rules.

**The preview tools (D-111) inspect the app, not the source.** Every preview page already carries
chobitsu — the CDP backend the preview Service Worker injects (`ide/public/sw.js`) — and the
DevTools panel relays it to chii; the same channel now has a programmatic client
(`ide/src/vv/preview-cdp.ts`) so the model can see runtime console/network failures, reproduce
a click flow and take a screenshot (D-112) before proposing a fix. They act on the *running app's
own state* (they can create or delete data in it) and never write the project; with no project
running they answer `{ available: false }` as data. A screenshot is shown in the activity row and
sent to the model only when the configured preset accepts images. A login screen is part of the
flow, not a failure: the preview shares the user's session (the kernel keeps the app's cookie jar
per project), so the prompt (D-115) tells the model to use it, or to register a throwaway account
in the dev database, and to hand anything outside the frame (OAuth/SSO, 2FA) back to the user.

Phase 2 (write-intent, still validator-gated): `run_check({ name: "typecheck" | "test" })` (fixed
allowlist, no arguments, executed in the WebContainer) and possibly a patch-draft helper. There is
no `apply_patch` tool: the proposal+Apply path is already the write contract.

Never exposed: shell, network, `process.env`, `node_modules`, `.git` internals, IDE storage,
any path outside the project root, secrets (AI-SKILLS §3/§6 exclusions, plus the existing
`.gitignore`-style ignored paths, D-054).

Every call is logged (tool, path, bytes, duration, outcome) in the trace; there is no turn budget
that could refuse it (D-108).
Tool output is **data**: it can be quoted, never treated as instructions.

## 7. Prompt and model contract

- `SYSTEM_PROMPT` gains a *Project exploration (PTC)* section: the tool signatures, the
  "explore before rewriting; never assume a file's content" rule, the script/patches turn rule,
  and a minimal example. The section is **generated from the registry** so code and prompt cannot
  drift; a test asserts the prompt lists exactly the registered tools.
- Model A's preloaded context shrinks to: project file list (names only), config facts, manifest
  summary and AGENTS.md. File bodies and the schema source are **not** preloaded; the model reads
  what it needs. This is the direct answer to "passing files in the input does not scale".
- The repair loop (§9.4) feeds a fix plan grouped by file, root cause first, then the findings;
  with the runtime on it tells the model to `read_file` the implicated paths and to `validate`
  the exact set before answering (D-102: set-level validation, per-file feedback; no attempt
  cap since D-108). The runtime is always on, so the correction never inlines file content (D-103).

## 8. MCP (phase 3)

The registry is transport-agnostic; an MCP server is just another tool provider:

- **Transport:** remote *Streamable HTTP* (POST/SSE) first — the IDE is a browser and has no
  stdio; a local stdio bridge would be a desktop-host feature later.
- **Enablement:** the user adds a server per project (URL + auth), sees its tool list and
  capabilities, and enables it explicitly; nothing is auto-connected (D-067 spirit).
- **Namespacing:** tools appear as `mcp_<server>_<tool>`; script code calls
  `tools.mcp_crm_lookup(...)`. Schemas come from MCP `tools/list` and are rendered into the
  prompt section.
- **Policy:** server URL must be in the deployment's `connect-src`; per-call timeout; results
  capped and redacted like local tools; a write-capable MCP tool is not allowed to touch the
  project (it is a remote effect, not a patch) and is disabled by default; every call is audited.
- **Managed deployments:** an allowlist of servers/tools in the deployment policy; default off.
- **Threat model:** MCP output is data; it cannot grant capabilities; the patch validator and the
  user's Apply remain the only write path; prompt injection can at worst make the model read/quote
  project data into the provider context, which is already the AI trust boundary (D-066) and is
  redacted by the policy.

## 9. Skills (D-067)

A skill is instructions + declared capabilities; PTC is how the model executes within them.

- `capabilities.tools` narrows the router's allowlist for a turn; `capabilities.read` narrows
  the path/glob policy; both are enforced on the host side, never in the prompt.
- Skill resources are readable only through a declared tool call and the read globs.
- No skill is auto-enabled; the trace shows which skill's capability authorized each call.
- This finally gives the "skills runtime" in AI-SKILLS §1 a concrete executor instead of prose.

## 10. UX and audit

- Each turn renders an explorable **"Esplorazione"** card (`ChatTraceView`, landed 2026-11-07):
  the programs (collapsed), each tool call with args/size/duration/outcome, and the typed error
  of a failed program; `ChatSession` keeps the rows in `ChatState.trace` / `exploring`. The
  dev mock provider emits one exploration program when the message says "ptc"/"esplora", so the
  card is testable without a provider key.
- Before the first exploration of a large turn, a "what will be sent" report (AI-SKILLS §6).
- Cancel stops both the provider call and the sandbox.
- Audit log: provider/model, skill/server ids, tool calls (path, bytes, duration), proposals and
  the final git commit (AI-SKILLS §8.6). Local, exportable.

## 11. Security summary

| Surface | Control |
|---|---|
| program code | opaque-origin iframe, CSP `default-src 'none'`, parent-side RPC allowlist, timeout/termination |
| tool calls | project-root confinement, glob/secret policy, capability narrowing, caps, redaction |
| writes | none from tools or programs; only the validated proposal + user Apply |
| egress | sandbox has no network; the only egress is the model provider (existing allowlist) |
| prompt injection | project/MCP content is data; it cannot grant capabilities; read-only exploration limits damage |
| secrets | excluded from tool results and context; redaction is shared with AI-SKILLS §3 |

## 12. Delivery plan

| Phase | Scope | Exit gate |
|---|---|---|
| 0 (spike) — **done 2026-11-07** | iframe sandbox + RPC + limits under COOP/COEP; fake tools; bomb/timeout tests (`spikes/ptc-sandbox`, 21/21) | opaque origin, no OPFS/storage/network, RPC, worker termination, parent stays responsive |
| 1 (MVP) | runner page served with the CSP header; ToolRouter over VFS + analyzer + manifest; registry + generated prompt; script envelope + turn loop; `validate` tool; **chain + trace UI landed 2026-11-07, always on (D-103) — eval corpus and browser matrix remain** | a real "add attachments to todos" turn succeeds by exploring, not by preloaded context; the model validates its own patches and the final gate stays green |
| 2 | `run_check` (allowlisted), skill capability narrowing, eval corpus | no regression on the 16-rule validator; token/cost report |
| 3 | MCP client + project-level enablement + managed allowlist | user-added remote server callable through a program, audited |
| 4 | default-on decision, Model A kept as fallback, cost/latency dashboard | measured pass rate and cost vs Model A on the corpus |

**Phase 1 chain landed (2026-11-07) and always on (D-103).**

- Wire vocabulary and caps: `ide/src/ai/ptc/protocol.ts`; policy (project-root confinement,
  excluded/secret paths, redaction, glob scoping): `policy.ts`; the nine read-only tools including
  `validate`: `tools.ts`.
- Runner: `runner.ts` (child lifecycle, tool RPC with trace, size limits, timeout,
  abort, always terminate), `runner-frame.ts` (opaque-origin iframe transport),
  `ide/public/ptc-runner.html` (one blob Worker per program). The page CSP has no
  `'unsafe-eval'`: Chromium blocks `new Function`, so the program is inserted textually into the
  worker. One router per program (`executorFactory`) keeps analyzer facts fresh across turns.
- Protocol/loop: `response.ts` accepts the `script` turn (script XOR patches), `turn.ts` runs
  the exploration loop, hands validation failures to the repair loop, and
  `repair.ts` points at the tools instead of inlining files when the runtime is on; the tool
  section of the prompt is generated from the registry (`prompt.ts`, `chat-context.ts`).
- Headers: `ide/vite.ptc.ts` for dev/preview and the `/ptc-runner.html` rule in
  `ide/public/_headers` for Cloudflare Pages (the `/*` rule already carries COOP/COEP).
- Browser proof: `node scripts/dev/check-ptc-runner.mjs` (9/9: result + trace, tool RPC,
  CSP-blocked worker fetch, opaque origin, the iframe relays while the worker is stuck, a >5 s
  loop is killed, a fresh sandbox works after termination).
- Activity UI: `ChatTraceView` renders the model calls (duration, characters, outcome, and the
  reasoning when the provider exposes it) next to the runs (program, tool calls,
  args/duration/bytes, typed errors) plus the live reasoning (D-110); the rows are pure helpers in
  `chat-trace.ts` and the session wiring is `chat-turn-hooks.ts`.
- Remaining for phase 1: the eval corpus (needs a real provider/key; the first manual run is its
  seed) and the browser matrix.

## 13. Open questions (O-016)

Resolved 2026-11-07 (D-101): sandbox substrate (opaque-origin iframe + inner blob Worker, proved
by the phase-0 spike), PTC-pure protocol, spike-first order, and the `validate` self-check with
the final gate kept as a safety net.

Still open:

1. **Conversation length:** with no quotas (D-108), a long turn is bounded only by the provider's
   context window; watch real sessions on the eval corpus.
2. **MCP transports:** remote HTTP only at first; stdio needs a desktop host.
3. **Managed policy:** which servers/tools are allowed by default (probably none).
4. **Browser matrix:** Firefox/Safari isolation and CSP-header behavior before a managed rollout.

## 14. Test strategy

- **Sandbox spike:** `spikes/ptc-sandbox` (CDP, Chromium) + `scripts/dev/check-ptc-runner.mjs`
  for the real runner page: opaque origin, no storage/network, tool RPC, timeout termination and
  a fresh sandbox afterwards.
- **Script runner:** unit tests with a fake RPC bridge (Node): return values, exception mapping,
  abort, output caps, malformed messages.
- **Policy:** path traversal (`..`, absolute, symlink-like), secret redaction, glob scoping,
  skill capability narrowing, MCP tool namespace collisions.
- **Turn loop:** script→result→final alternation, no quotas (many programs and parts), abort,
  provider failure, validator rejection after exploration, repair using tools instead of inlined
  files.
- **Prompt:** registry↔prompt parity, no stale tool names, size cap.
- **Eval:** a small corpus of realistic requests (add field, add route+UI, diagnose failing
  build) comparing pass rate, model calls, tokens and wall time against Model A.
