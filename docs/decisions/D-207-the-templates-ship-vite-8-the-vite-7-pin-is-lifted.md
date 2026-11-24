# D-207 — The templates ship Vite 8; the Vite 7 pin is lifted
**Status:** accepted (2026-11-24)

**Context.** D-021 pinned the IDE templates to `vite@^7.1.0` because Vite 8's rolldown wasm
binding could not load in the WebContainer, and recorded the plan to return to `^8.0.0` once
the upstream rolldown fix landed. The examples now ship `vite 8.3.5`
(`examples/*/package.json`); the in-VM path is proven (D-090 template-v2, D-202 prerendering on
both stacks), and the version comes from the inlined example, not from `project-files.ts`. The
switch itself was never recorded as a decision.

**Decision.** The templates ship Vite 8 (8.3.5 in the examples); the Vite 7 pin of D-021 is
lifted. Bump policy: a Vite bump lands only with a green `pnpm ide:smoke` (the in-VM gate), and
the `@rolldown/binding-wasm32-wasi` entries stay in the templates so the wasm binding resolves
in the WebContainer. D-021's scripted-environment decision stands; only its version pin is
superseded.

**Consequences.** AGENTS.md, DEV.md and ide/README.md no longer claim a `^7.1.0` template pin;
Vite mentions match the examples (8.3.5) or state the bump policy. D-021's file is kept
unchanged (append-only).
