# Documentation map

Start with one of these three, depending on the question:

- **What is the contract?** [SPEC.md](./SPEC.md) — architecture, types, endpoints, security, AI,
  release tooling, acceptance criteria. This is the source of truth; other docs may explain it.
- **Where is the system today?** [STATUS.md](./STATUS.md) — what ships, what is open, what is
  retired, and the commands that prove it.
- **Why is it like this?** [DECISIONS.md](./DECISIONS.md) — the ADR reading guide and the
  open-items table; each decision is one file in [decisions/](./decisions/).

## Contract and state

| Doc | Role |
|---|---|
| [SPEC.md](./SPEC.md) | The contract. If it disagrees with anything else, it wins. |
| [STATUS.md](./STATUS.md) | Current state: implemented, open, retired, evidence. |
| [DECISIONS.md](./DECISIONS.md) | Decision log: reading guide and the "Open" table (O-001…O-021). |
| [decisions/](./decisions/README.md) | One file per decision (D-001…D-210) with a generated index; gated by `pnpm lint`. |
| [../AGENTS.md](../AGENTS.md) | Conventions for working in this repository. |

## Environment and operation

| Doc | Role |
|---|---|
| [DEV.md](./DEV.md) | Build, run and verify on a bare machine (the only setup recipe). |
| [MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md) | Open/managed builds, policy, CSP, admission. |
| [APP-UPDATES.md](./APP-UPDATES.md) | Offline project-update recipes and the marker. |
| [MIGRATION-PLAN.md](./MIGRATION-PLAN.md) | Release-time DDL and artifacts (P0–P2, P5/P6 and the P4 preview slice landed; the deploy applier is withdrawn, D-204). |
| [POSTGRES.md](./POSTGRES.md) | Running a generated app on Postgres. |
| [LOGS.md](./LOGS.md) | Operator contract for access/error/audit/app logs. |
| [TELEMETRY.md](./TELEMETRY.md) | Operator guide: collector setup, privacy hardening, data minimization, consent (D-203/D-210). |

## Guides

| Doc | Role |
|---|---|
| [DEMO.md](./DEMO.md) | The three-minute demo script. |
| [FRONTEND.md](./FRONTEND.md) | The generated app's client contract: layout, routing, session, theme, i18n. |
| [DESIGN.md](./DESIGN.md) | The visual system: tokens, type, motion, page anatomy and the AI's design block. |
| [PATTERNS.md](./PATTERNS.md) | The list → detail → chart section standard used by the AI and humans. |
| [UI-PATTERNS.md](./UI-PATTERNS.md) | The interaction defaults the AI applies: create dialog, calendar route, filter drawer, confirmations, responsive states (D-186). |
| [AI-VALIDATION.md](./AI-VALIDATION.md) | Plain-language guide to the AI patch validator: the 19 rules with pass/fail examples. |
| [AI-SKILLS.md](./AI-SKILLS.md) | AI trust boundary: provider/gateway policy, the blocking validator, PTC + MCP; the skills supply-chain design is historical (D-205). |
| [CHAT-UX.md](./CHAT-UX.md) | Chat transcript and compaction direction (the file picker is still open). |

## Design references

| Doc | Role |
|---|---|
| [PTC.md](./PTC.md) | The PTC tool runtime (the chat's only mode). |
| [JOBS.md](./JOBS.md) | Background jobs: contract, runtime, semantics. |
| [WORKFLOWS.md](./WORKFLOWS.md) | Workflows and manual tasks (W1–W3 implemented). |
| [SSO.md](./SSO.md) | OIDC, OAuth2 and SAML as framework auth. |
| [WEBSITE.md](./WEBSITE.md) | The facilis.dev site brief and copy source. |

## Research

| Doc | Role |
|---|---|
| [findings/ast-dsl-contract.md](./findings/ast-dsl-contract.md) | Live design reference for the browser analyzer. |
| [findings/access-escalation.md](./findings/access-escalation.md) | Design record behind views and audited elevation (D-098/D-099). |
| [findings/security-audit.md](./findings/security-audit.md) | Static audit evidence; SEC-10 is still open (D-155). |
| [findings/prerender-hydration.md](./findings/prerender-hydration.md) | In-VM prerender + hydration spike behind D-202 (issue #80, epic #79). |
| [findings/dev-boot-reload-stall.md](./findings/dev-boot-reload-stall.md) | Measured boot profile of a data-carrying project reload (issue #36). |

## Archive

Superseded or historical documents are in [archive/](./archive/README.md): the Phase 1
coordination file, the pre-D-096 design direction, the IDE field report and the pre-cutover AST
feasibility study.

## How the docs work

- Every document starts with its declared status (implemented / accepted / proposed / historical).
- A contract change updates SPEC.md and adds a decision in the same change — one file in
  `decisions/` plus `pnpm decisions:index`, not an edit to the shared log; a move or rename
  updates this map.
- Historical material goes to **archive/** instead of being rewritten, so the reasoning survives
  without slowing a reader down.
