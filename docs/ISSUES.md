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

An `agent:ready` issue labelled `epic` is a plan: the claim and the pull request target one
of its children, never the epic itself — see [Epics](#epics).

Assignment wins over the label: a labelled issue with an assignee is taken, whether the
assignee is an agent or a human.

## Epics

An issue labelled `epic` is a plan, not a work item. **One epic is developed on one branch
(`feat/epic-<N>-<slug>`) with one pull request**: each child is a commit on that branch,
announced with a comment on the epic PR, and its issue is closed when implemented. The epic
PR carries `Closes #<epic>` and closes the epic when it merges; children never get their own
pull requests.

Children are ordinary issues (`bug`, `enhancement`, `task`) and **intentionally carry no
`agent:ready` label**: tagging them would let an agent pick a child out of plan order. They
are discovered from three sources, in order: the task list (`- [ ] #NNN`) in the epic body —
the authoritative plan order, grouped by phase with a suggested order — native GitHub
sub-issues, and membership back-references (`Part of #NNN`) in open child bodies, in creation
order. The epic's own `agent:ready` label is the hand-off for the whole plan, and the epic's
design rules and non-goals are binding for every child.

When an agent selects an `agent:ready` epic:

1. Read the epic body as the plan: the suggested order decides which child is actionable
   next. A prerequisite is satisfied when its child is closed; a prerequisite still in
   progress (assigned, not closed) blocks the child.
2. Pick the first actionable child in plan order that is open and unassigned, and claim the
   **child** (`gh issue edit <child> --add-assignee @me`) — never the epic. All children of
   one epic serialize on its branch: while a child is in progress, no other child of the
   same epic starts.
3. Develop the child on the epic branch (create it from `main` with the first child; reuse
   it afterwards), keeping the branch aligned to `main` (rebase, gates green,
   `--force-with-lease` push) so it does not drift while reviews are pending. The child's
   acceptance criteria plus the epic's rules apply. An uncertain alignment conflict is
   aborted and commented, never guessed.
4. Commit referencing the child (`feat(scope): summary (#<child>)`), push, and comment on the
   epic PR: child implemented, commit, gate evidence. Then close the child issue
   (`gh issue close <child>`) referencing the epic PR — GitHub checks the epic's task-list
   box automatically. Open the epic PR with the first child if it does not exist yet
   (`Closes #<epic>`); never open per-child PRs and never close the epic directly.

An epic whose children are all closed or in progress has nothing to do: skip it and select
the next `agent:ready` candidate. A blocker on one child is reported on that child (comment,
unassign); only a blocker that invalidates the whole plan removes `agent:ready` from the epic.

**Legacy stacked epics.** Epics developed before this model may have one pull request per
child, stacked on each other's branches. They are consolidated first: the stacked branches
are merged (topological order) into the single epic branch, one epic PR is opened, and the
stacked PRs are closed with a pointer comment (branches preserved). No new stacked PRs are
created.

## Labels

The repository owns three labels beyond GitHub's defaults. Their definition is
`scripts/sync-labels.mjs` — the single source of truth — and applying it is idempotent:

```sh
pnpm labels:sync             # create or update the labels; needs gh auth with write access
pnpm labels:sync -- --dry-run
```

| Label | Meaning |
| --- | --- |
| `task` | Internal work: refactor, docs, tooling or CI. |
| `epic` | A larger effort tracked as a parent of child issues (for example #56); with `agent:ready` it hands the whole plan to an agent — see [Epics](#epics). |
| `agent:ready` | Fully specified and ready for an AI agent to implement. |

## Pull requests

The title is a Conventional Commit in English. The description follows the template and
carries the verification evidence (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
plus a browser gate when the IDE or a template changes). `main` accepts changes only through
a reviewed pull request; the policy is in `AGENTS.md`.
