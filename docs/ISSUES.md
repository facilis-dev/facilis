# Issues and pull requests

Every issue is filed through a form in [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/)
and every pull request starts from
[`pull_request_template.md`](../.github/pull_request_template.md), so a thread always carries
the same fields. Blank issues are disabled.

## Which template

| Template | Use it for | Labels |
| --- | --- | --- |
| Bug report | Behaviour that contradicts `docs/SPEC.md`. | `bug` |
| Feature request | A capability the specification does not cover yet. | `enhancement` |
| Task | Refactors, documentation, tooling, CI, dependencies. | `task` |

A change in user-visible behaviour is a feature request; broken behaviour is a bug report.
The forms ask for the area, the expected result and testable acceptance criteria, because
those are the fields triage and an AI agent need before work can start.

## The `agent:ready` label

`agent:ready` is the hand-off marker between triage and an AI agent. **An AI agent may start
an issue only when it carries that label.** Without it the issue is not ready — a decision,
an acceptance criterion or a piece of scope is still missing — and the agent must not
implement it.

A maintainer adds the label once the issue meets the definition of ready:

- the problem and the intended behaviour are stated unambiguously;
- the acceptance criteria are testable;
- the affected area and the files or packages are known;
- no open decision in `docs/DECISIONS.md` blocks the change, and the change does not need a
  new contract decision first;
- nothing secret, credentialed or outside the repository is required.

A fresh report is a proposal, never agent-ready: the label is applied after triage, not by
the person filing. It is removed when the issue is closed, or when the scope changes enough
to invalidate the criteria.

### Agent protocol

1. List candidates: `gh issue list --label "agent:ready" --state open`.
2. Skip issues with an assignee: someone has already claimed them.
3. Claim the issue before the first edit: `gh issue edit <number> --add-assignee @me`.
4. Read `AGENTS.md`, the relevant `docs/SPEC.md` section and every `docs/DECISIONS.md` entry
   the issue cites.
5. Work in a dedicated worktree as `AGENTS.md` describes, and open the pull request with
   `Closes #<number>` and the Definition-of-done evidence.
6. If the issue turns out not to be ready — an opening decision, missing access, ambiguous
   acceptance criteria — stop, comment with the concrete blocker, unassign yourself and
   remove `agent:ready` so the next agent does not repeat the attempt.

Assignment wins over the label: a labelled issue with an assignee is taken, whether the
assignee is an agent or a human.

## Labels

The repository owns two labels beyond GitHub's defaults. Their definition is
`scripts/sync-labels.mjs` — the single source of truth — and applying it is idempotent:

```sh
pnpm labels:sync             # create or update the labels; needs gh auth with write access
pnpm labels:sync -- --dry-run
```

| Label | Meaning |
| --- | --- |
| `task` | Internal work: refactor, docs, tooling or CI. |
| `agent:ready` | Fully specified and ready for an AI agent to implement. |

## Pull requests

The title is a Conventional Commit in English. The description follows the template and
carries the verification evidence (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
plus a browser gate when the IDE or a template changes). `main` accepts changes only through
a reviewed pull request; the policy is in `AGENTS.md`.
