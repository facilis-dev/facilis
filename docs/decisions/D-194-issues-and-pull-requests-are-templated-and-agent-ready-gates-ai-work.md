# D-194 — Issues and pull requests are templated, and `agent:ready` gates AI work
**Status:** accepted (2026-11-18)

**Context.** Issues arrived in free form, so the fields triage and an AI agent need (area,
expected result, testable acceptance criteria, verification) were present only when the
reporter happened to include them. Pull requests carried the Definition-of-done evidence by
convention, not by structure, and nothing marked which issues an agent was allowed to start.

**Decision.** Blank issues are disabled. Every issue uses one of three issue forms — bug
report, feature request, task — and every pull request starts from a single template whose
checklist mirrors the Definition of done in `AGENTS.md`. A new label, **`agent:ready`**, is
the hand-off between triage and an AI agent: an agent starts an issue only when the label is
present, claims it by assignment before the first edit, and removes it if the issue turns out
not to be ready. The definition of ready and the agent protocol live in `docs/ISSUES.md`;
the label is owned by `scripts/sync-labels.mjs` and applied with `pnpm labels:sync`.

**Consequences.** Issue forms cannot set a label conditionally, so a maintainer applies
`agent:ready` after triage; a fresh report is never agent-ready. Assignment is the claim, so
a human and an agent use the same rule. The templates make triage and review comparable
across issues and PRs, and the pull-request checklist keeps the 2026-11-12 evidence
requirement visible at the point where it is needed.
