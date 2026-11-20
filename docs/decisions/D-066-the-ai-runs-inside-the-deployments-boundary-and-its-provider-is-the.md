# D-066 — The AI runs inside the deployment's boundary, and its provider is the one declared exception
**Status:** accepted (2026-11-01)

The AI reads project content, calls a remote provider and proposes writes. The browser sandbox
protects the machine, not the IDE's data: it does not stop a generated app from reading the BYO
key from the IDE origin, and it does not decide what leaves the browser. The settings can also
point the provider at a custom base URL, and the patch validator is still a Phase-0 skeleton.

**Decision.** AI is a deployment-governed feature, not an ambient one. Contract:
`docs/AI-SKILLS.md`.

- egress is one declared exception: `ai.mode` is `off`, `byo` (allowlisted provider presets) or
  `gateway` (internal endpoint); provider hosts are compiled into `connect-src`, and a custom
  base URL is rejected in `managed`.
- the BYO key stays in `localStorage` and requires preview isolation, so enabling AI and
  isolating the preview ship together.
- the instruction hierarchy is fixed: only the build's system prompt and the user's actions can
  grant capabilities; `AGENTS.md`, project files, the manifest, tool output and third-party
  skill content are data or subordinate instructions.
- provider output is untrusted and only the user's Apply writes; the blocking validator rules
  (auth/RLS/`dbTables`/raw db/package policy/secrets/paths, plus tool calls) are a prerequisite,
  so `managed` defaults to `ai.mode: "off"` until they exist.
- Model B tools are a closed primitive set with no shell and no network.

**Consequences:** AI is opt-in per deployment; in `managed` the key is not reachable from
generated code; O-009 (letting the AI edit `package.json`) is gated by the dependency policy;
`open` keeps today's BYO behaviour with a warning that a project can read the key.
