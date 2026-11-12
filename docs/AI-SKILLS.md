# AI and skills

**Status:** accepted and implemented (2026-11-11) except the skills runtime: the provider/gateway
policy, the "AI off by default in managed" behaviour, the 19-rule blocking validator (D-084/D-162) and
the PTC tool runtime — the chat's only mode (D-101/D-103) — landed. Still pending: the skills
runtime and MCP servers on the same PTC seam (design: [`PTC.md`](./PTC.md), O-016).
Decisions: D-066 (AI security boundary), D-067 (skills as a reviewed supply chain).
Related: [MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md), [APP-UPDATES.md](./APP-UPDATES.md),
SPEC §8 and §9, D-045, D-046, D-047, D-048.

The AI is the feature with the largest blast radius in the IDE: it reads project content,
calls a remote provider, and proposes writes. The browser sandbox protects the machine, not
the IDE's data - it does not stop a generated app from reading the AI key from the IDE origin,
and it does not decide what leaves the browser. This document fixes the trust boundary for the
AI (D-066) and the format and policy for skills (D-067).

Non-goals: new provider integrations, a server-side AI proxy (L3 is out of scope,
D-063), automatic skill execution outside the WebContainer.

## 1. Trust hierarchy

| Source | Status | Can instruct? | Can grant a capability? |
|---|---|---|---|
| IDE system prompt (shipped in the build) | trusted | yes | **yes, only here** |
| the user's explicit action (Apply, enable a skill) | trusted | yes | **yes (consent)** |
| project instructions (`AGENTS.md`) | user content, subordinate | yes, within IDE rules | no |
| project files, README, comments | data | no | no |
| the live manifest from the running app | data | no | no |
| approved skill content | instructions within declared capabilities | yes | no |
| third-party or disabled skill content | data | no | no |
| provider output | untrusted | no (proposal only) | no |

The rule: a capability is granted only by the build or by a user action. Content cannot grant
one; the worst case is that the user reads a malicious proposal and applies it, which is why
the validator is blocking and the diff is always shown.

## 2. Egress

| What | When | Where it is declared |
|---|---|---|
| provider API | `ai.mode: "byo"` | `ai.providers` allowlist, compiled into `connect-src` |
| internal LLM gateway | `ai.mode: "gateway"` | `ai.gateway` URL, compiled into `connect-src` |
| AI web tools (`web_fetch`/`web_image`/`web_download`) | `open`: any HTTPS host the browser can read; `managed`: only origins in `network.connect`; empty list = no tools (D-175) | `network.connect`, compiled into `connect-src` |
| everything else | never | not exposed as a tool |

Notes:

- `connect-src` is per document. The IDE document is allowed the providers; the preview
  document (a separate origin) is allowed only the app's own `/api`. With the preview on the
  same origin there is one allowlist for both, which is why preview isolation is a
  prerequisite for enabling AI in `managed`, not a nicety (D-063, MANAGED-DEPLOYMENT §5).
- the custom base URL (`settings.baseUrl`, used by the `Custom` preset) is a developer
  feature of `open`. A `managed` build rejects it: providers are a deployment decision.
- air-gapped: `ai.mode: "off"` or `ai.mode: "gateway"` pointing at an internal endpoint.
  Both keep the "no direct provider" property; the gateway is infrastructure, not app logic.

## 3. The key

- the BYO key lives in `localStorage` (`vv-ai-settings`) and is never encrypted (D-045: an
  obfuscated key beside its own de-obfuscator is a fig leaf). That is acceptable **only** if
  project code cannot read the IDE origin.
- the key never enters the prompt, the context, a skill or a patch. Context assembly excludes
  `.env*`, `.git/**`, IDE settings, stored git credentials and anything matching the
  secret patterns of §7.
- `gateway` mode keeps no key in the browser at all; the gateway owns it server-side.
- enabling AI therefore requires preview isolation. In `managed` the two ship together; in
  `open` the user is warned that a project can read the key.

## 4. Apply path

- provider output is untrusted text (`ide/src/ai/response.ts`); it becomes a proposal, and
  only the user's Apply writes (D-046).
- every write goes through `applyPatch` and the validator; undo and the project's git history
  are the audit trail (D-047).
- blocking validator rules required before `managed` may enable AI:
  1. a route without `defineAuthorizedHandler`;
  2. a missing or inaccurate `dbTables`;
  3. a scoped table without its RLS policy;
  4. a raw Drizzle client import outside ```facilis/db`;
  5. a `package.json`, lockfile or `.npmrc` change — rule 11 rejects it in both profiles (O-009);
  6. secret-looking content in a patch;
  7. a path outside the deployment's writable set (open: the project minus the install surface, the VCS/IDE/build state and `AGENTS.md`; managed: the six roots plus `facilis.config.ts`) or outside the skill's write capability (D-167);
  8. a Model B tool call outside the declared capability set.
  Until these exist, `managed` defaults to `ai.mode: "off"` - fail-closed, not "we will
  add the rules later".

## 5. Instruction handling

- the system prompt delimits every source and states its origin; project content is quoted as
  data.
- `AGENTS.md` is subordinate (D-048): it can describe conventions, not permissions. A project
  imported from elsewhere cannot use it to widen anything.
- the manifest is data: the running app can influence it.
- approved skills are instructions, but still cannot grant; an unapproved skill's content is
  data and is never inserted into the prompt.
- text the user pastes into the chat is data too.

## 6. Context

The chat reads the project through the PTC tool registry (D-101/D-103) instead of preloading it,
so the boundary is the registry, not a context window.

- sources: the tools return files, analyzer facts, config, manifest and catalogs on request
  (D-045/D-048); the preloaded summary is context, never the whole project.
- never: secrets, other projects, IDE internals, `node_modules` beyond the `.d.ts` it
  already feeds to IntelliSense.
- secret scan before send: redact and tell the user, never send silently.

## 7. Tools

The live registry is the PTC one ([`PTC.md`](./PTC.md)): `list_files`, `read_file`, `search`,
`get_schema`, `get_routes`, `get_config`, `get_manifest`, `get_i18n`, the preview family
(D-111), the project-graph family (D-126), the git family (D-139) and the host-side web family
(`web_fetch`, `web_image`, `web_download`, deployment-gated, D-175). Tool output is data. A tool
call is never a capability grant: source writes still go through the validator and the user's
Apply, and every call is logged.

## 8. Skills

### 8.1 What a skill is

A versioned bundle that *instructs the model* for a class of tasks, with declared
capabilities. It is not a plugin and not a dependency: it cannot add code to the app at
runtime. It is **supply chain**, because its text steers code generation.

### 8.2 Format

```
skill/
  skill.json        manifest (identity, capabilities, integrity, signature)
  SKILL.md          the instructions
  resources/...     optional templates, examples, snippets
```

```json
{
  "schemaVersion": 1,
  "id": "@acme/ui-review",
  "version": "1.2.0",
  "description": "Reviews components against the kit and proposes fixes.",
  "publisher": "acme",
  "capabilities": {
    "read": ["src/**", "components/**", "lib/**"],
    "write": ["components/**"],
    "tools": ["read-file", "list-files", "apply-patch"],
    "network": false,
    "commands": []
  },
  "integrity": "sha256-...",
  "signature": "..."
}
```

`SKILL.md` is plain Markdown: no secrets, no remote fetches, deterministic wording. The
`resources/` directory is inert until a declared tool or the model reads it.

### 8.3 Capabilities

| Field | Meaning | Default |
|---|---|---|
| `read` | path globs the skill may read through the tools/context | `[]` |
| `write` | path globs the skill's patches may touch | `[]` |
| `tools` | subset of the primitive tool set | `[]` |
| `network` | a skill cannot request network; still `false` only (the host-side web tools are not a skill capability, D-175) | `false` |
| `commands` | subset of the `run-check` allowlist | `[]` |

Capabilities are a maximum, not a grant: the actual patch/tool call must fit, and a violation
is a blocking error. No text in `SKILL.md` can add a capability.

### 8.4 Resolution and enablement

- source: the deployment's skill catalog (static index or the same mirror as packages), or a
  local skill for `open`.
- verify `integrity` and `signature` (publisher key pinned by the company), then check
  `skills.allow` and the version baseline.
- show publisher, version, capabilities and changelog; the user enables it per project from the
  allowed set. `managed` ships pre-approved skills and still shows what each one can do.
- no auto-enable, no auto-update.

### 8.5 Enforcement map

| Capability | Enforced at |
|---|---|
| `read` globs | context assembly and `read-file`/`list-files` |
| `write` globs | validator and `applyPatch` |
| `tools` | the tool router |
| `network` | no skill holds it; skill scripts run in the WebContainer under the same egress policy, and the PTC host's `web_*` tools are gated by the deployment profile instead (D-175) |
| `commands` | the `run-check` allowlist |
| allowlist/version | resolution, before the skill can be enabled |

### 8.6 Audit

For every applied proposal, record skill id/version, provider and model, the files written and
the user who applied it. The git commit is the durable record; the IDE's log is the readable
one, and an enterprise can export it.

### 8.7 Updates

Skills follow D-065: pinned versions, "updates available" in the same panel, approved baseline
in `managed`, ignore/pin for the adopter. A skill update is reviewed like a dependency.

### 8.8 Authoring rules

- no secrets or tokens in any file;
- minimal capabilities (a reviewer should be able to see why `write` is needed);
- deterministic wording, no "fetch this URL" — a skill cannot fetch, and the host's web tools
  are not part of a skill (D-175);
- test against `examples/todo-app`;
- if a skill needs to change auth or the config, that is a red flag: it needs the write
  capability on that path and an explicit user review.

## 9. Deployment policy surface

```ts
ai: {
  mode: "off",                 // "off" | "byo" | "gateway"
  providers: [],               // allowlisted preset ids, when mode is "byo"
  gateway: null,               // URL, when mode is "gateway"
},
skills: { allow: [] },          // skill ids; empty means none
```

`managed` defaults: `ai.mode: "off"` and no skills. `open` keeps today's behaviour
(presets plus `Custom`, any installed skill) with a warning when a project can read the key.

## 10. Open questions

- distribution: a static catalog in the repository versus a registry; who holds the signing
  key.
- enablement granularity: per project from a deployment allowlist, or deployment-wide only.
- whether skills may ship scripts at all (and if so, their capability model), or only text.
- whether `gateway` mode is in scope before L3 is reconsidered.
- where the skills UI lives, and how it composes with `AGENTS.md`.
