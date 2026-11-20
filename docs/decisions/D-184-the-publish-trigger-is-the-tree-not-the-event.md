# D-184 — The publish trigger is the tree, not the event
**Status:** accepted (2026-11-14)

**Context.** D-164's job decided whether to publish from the event: on `workflow_dispatch` it
trusted the `publish` input, otherwise it diffed `HEAD^..HEAD -- packages/`. Both halves were
wrong. A manual run published because someone ticked a box, not because there was anything to
publish; and every retry of a deploy re-published, because `HEAD^..HEAD` shows the same change on
every run — a failed upload was "repaired" by minting a second version. D-183 gives the last
published tree a name (the release tag `vX.Y.Z`), so the question is answerable directly.

**Decision.** The job publishes when the tree differs from the last release tag
(`git describe --tags --abbrev=0 --match 'v[0-9]*'`) in `packages/` or `tsconfig.base.json`,
excluding test modules and test fixtures (they are filtered out of the tarball), and when no tag
exists yet. The `publish` input forces a publish only when that diff is empty. The checkout fetches
the full history and tags so the diff can reach any ancestor tag. A diff that cannot be computed
counts as "publish": an extra patch is harmless, deploying an IDE against stale packages is not.

**Consequences.** Push and manual runs agree, and re-running a deploy is idempotent — it rebuilds
the IDE against the already published version instead of minting a new one. Because the decision
now needs history, the checkout is a full clone instead of `fetch-depth: 2`; the repository is
small and the job already pays minutes for Rust, so the trade is not worth a sparse fetch. A publish that
died after uploading but before the tag leaves npm ahead of the tag; `pnpm release:status`
reports it, and the next run publishes one more patch and tags that one, so the ledger converges
at the cost of a single spare version. That is a consequence of D-183's tag-after-publish order,
not of this rule.
