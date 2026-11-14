# Documentation map

Start with one of these three, depending on the question:

- **What is the contract?** [SPEC.md](./SPEC.md) — architecture, types, endpoints, security, AI,
  release tooling, acceptance criteria. This is the source of truth; other docs may explain it.
- **Where is the system today?** [STATUS.md](./STATUS.md) — what ships, what is open, what is
  retired, and the commands that prove it.
- **Why is it like this?** [DECISIONS.md](./DECISIONS.md) — the ADR log and the open-items table.

## Contract and state

| Doc | Role |
|---|---|
| [SPEC.md](./SPEC.md) | The contract. If it disagrees with anything else, it wins. |
| [STATUS.md](./STATUS.md) | Current state: implemented, open, retired, evidence. |
| [DECISIONS.md](./DECISIONS.md) | Decision log (D-001…D-160) and the "Open" table (O-001…O-020). |
| [../AGENTS.md](../AGENTS.md) | Conventions for working in this repository. |

## Environment and operation

| Doc | Role |
|---|---|
| [DEV.md](./DEV.md) | Build, run and verify on a bare machine (the only setup recipe). |
| [MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md) | Open/managed builds, policy, CSP, admission. |
| [APP-UPDATES.md](./APP-UPDATES.md) | Offline project-update recipes and the marker. |
| [MIGRATION-PLAN.md](./MIGRATION-PLAN.md) | Release-time DDL, artifacts and the deploy ledger (P0–P2 implemented). |
| [POSTGRES.md](./POSTGRES.md) | Running a generated app on Postgres. |
| [LOGS.md](./LOGS.md) | Operator contract for access/error/audit/app logs. |

## Guides

| Doc | Role |
|---|---|
| [DEMO.md](./DEMO.md) | The three-minute demo script. |
| [FRONTEND.md](./FRONTEND.md) | The generated app's client contract: layout, routing, session, theme, i18n. |
| [DESIGN.md](./DESIGN.md) | The visual system: tokens, type, motion, page anatomy and the AI's design block. |
| [PATTERNS.md](./PATTERNS.md) | The list → detail → chart section standard used by the AI and humans. |
| [AI-SKILLS.md](./AI-SKILLS.md) | AI trust boundary and the skills supply chain. |
| [CHAT-UX.md](./CHAT-UX.md) | Chat transcript and compaction direction (the file picker is still open). |

## Design references

| Doc | Role |
|---|---|
| [PTC.md](./PTC.md) | The PTC tool runtime (the chat's only mode). |
| [JOBS.md](./JOBS.md) | Background jobs: contract, runtime, semantics. |
| [WORKFLOWS.md](./WORKFLOWS.md) | Workflows and manual tasks (W1 implemented, W2–W3 planned). |
| [SSO.md](./SSO.md) | OIDC, OAuth2 and SAML as framework auth. |
| [WEBSITE.md](./WEBSITE.md) | The facilis.dev site brief and copy source. |

## Research

| Doc | Role |
|---|---|
| [findings/ast-dsl-contract.md](./findings/ast-dsl-contract.md) | Live design reference for the browser analyzer. |
| [findings/access-escalation.md](./findings/access-escalation.md) | Design record behind views and audited elevation (D-098/D-099). |
| [findings/security-audit.md](./findings/security-audit.md) | Static audit evidence; SEC-10 is still open (D-155). |

## Archive

Superseded or historical documents are in [archive/](./archive/README.md): the Phase 1
coordination file, the pre-D-096 design direction, the IDE field report and the pre-cutover AST
feasibility study.

## How the docs work

- Every document starts with its declared status (implemented / accepted / proposed / historical).
- A contract change updates SPEC.md and DECISIONS.md in the same change; a move or rename updates
  this map.
- Historical material goes to **archive/** instead of being rewritten, so the reasoning survives
  without slowing a reader down.
