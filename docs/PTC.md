# PTC tool runtime (Model B) — design proposal

**Status:** proposal, not implemented (2026-11-07). Tracked as **O-016** in
[`DECISIONS.md`](./DECISIONS.md). Related: [`SPEC.md`](./SPEC.md) §9.1/§9.4/§9.5,
[`AI-SKILLS.md`](./AI-SKILLS.md) §6–§8 (D-066, D-067), D-045/D-046 (chat), D-084 (validator),
D-100 (repair loop).

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
async bindings, lossless-JSON results, bounded budget, failure as data.

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
- **Bounds:** at most 6 script turns per user message (configurable), 1 program each; program
  ≤ 16 KB source; 5 s wall clock; 32 tool calls per program and 64 per user message; one tool
  result ≤ 32 KB and ≤ 256 KB total per user message. Over-budget → typed failure + forced final
  answer. Cancellation aborts the provider request and the sandbox.
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

Phase 2 (write-intent, still validator-gated): `run_check({ name: "typecheck" | "test" })` (fixed
allowlist, no arguments, executed in the WebContainer) and possibly a patch-draft helper. There is
no `apply_patch` tool: the proposal+Apply path is already the write contract.

Never exposed: shell, network, `process.env`, `node_modules`, `.git` internals, IDE storage,
any path outside the project root, secrets (AI-SKILLS §3/§6 exclusions, plus the existing
`.gitignore`-style ignored paths, D-054).

Every call is logged (tool, path, bytes, duration, outcome) and counts against the turn budget.
Tool output is **data**: it can be quoted, never treated as instructions.

## 7. Prompt and model contract

- `SYSTEM_PROMPT` gains a *Project exploration (PTC)* section: the tool signatures, the
  "explore before rewriting; never assume a file's content" rule, the script/patches turn rule,
  and a minimal example. The section is **generated from the registry** so code and prompt cannot
  drift; a test asserts the prompt lists exactly the registered tools.
- Model A's preloaded context shrinks to: project file list (names only), config facts, manifest
  summary and AGENTS.md. File bodies and the schema source are **not** preloaded; the model reads
  what it needs. This is the direct answer to "passing files in the input does not scale".
- The repair loop (§9.4) then feeds findings only. The current-content block in
  `ide/src/ai/repair.ts` is a D-100 stopgap and is **removed when phase 1 lands**; the repair
  prompt tells the model to `read_file` the implicated paths instead.

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

- Each turn renders an explorable **"Esplorazione"** card: the programs (collapsed), each tool
  call with path/size/duration/outcome, and the errors. The user can see exactly what left the
  browser and what the model learned.
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
| 0 (spike) | iframe sandbox + RPC + limits under COOP/COEP/WebContainer; fake tools; bomb/timeout tests | credentials-free proof: opaque origin, no OPFS/storage/network, clean termination |
| 1 (MVP) | ToolRouter over VFS + analyzer + manifest; registry + generated prompt; script envelope + turn loop + trace UI; dev flag; repair loop switches to tools and drops the content stopgap | a real "add attachments to todos" turn succeeds by exploring, not by preloaded context; validator still blocks bad patches |
| 2 | `run_check` (allowlisted), skill capability narrowing, eval corpus | no regression on the 16-rule validator; token/cost report |
| 3 | MCP client + project-level enablement + managed allowlist | user-added remote server callable through a program, audited |
| 4 | default-on decision, Model A kept as fallback, cost/latency dashboard | measured pass rate and cost vs Model A on the corpus |

## 13. Open questions (O-016)

1. **Sandbox substrate:** opaque-origin iframe (recommended) vs a WebContainer-isolated process.
   The spike answers whether the iframe survives the IDE's COOP/COEP + kernel setup.
2. **Script vs native function calling:** PTC as the primary mode (user's direction); keep a
   native-tools adapter as a later provider-compatibility mode?
3. **Final-answer protocol:** `script` and `patches` mutually exclusive in one object
   (recommended) vs a separate "done" turn.
4. **Exploration budget:** 6 turns / 32 calls / 5 s defaults — tune on the eval corpus.
5. **MCP transports:** remote HTTP only at first; stdio needs a desktop host.
6. **Managed policy:** which servers/tools are allowed by default (probably none).
7. **Repair stopgap:** keep D-100's bounded current-file injection until phase 1, or remove it now
   and accept weaker whole-file repairs in the meantime.

## 14. Test strategy

- **Sandbox spike:** browser test (Playwright) asserting the iframe cannot read parent OPFS/
  localStorage, cannot `fetch`, and is killed on timeout; run in the existing smoke harness.
- **Script runner:** unit tests with a fake RPC bridge (Node): return values, exception mapping,
  abort, output caps, tool-call budget, malformed messages.
- **Policy:** path traversal (`..`, absolute, symlink-like), secret redaction, glob scoping,
  skill capability narrowing, MCP tool namespace collisions.
- **Turn loop:** script→result→final alternation, max turns, abort, provider failure, validator
  rejection after exploration, repair using tools instead of inlined files.
- **Prompt:** registry↔prompt parity, no stale tool names, size cap.
- **Eval:** a small corpus of realistic requests (add field, add route+UI, diagnose failing
  build) comparing pass rate, model calls, tokens and wall time against Model A.
