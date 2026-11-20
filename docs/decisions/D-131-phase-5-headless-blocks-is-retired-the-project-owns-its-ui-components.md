# D-131 — Phase 5 (headless blocks) is retired: the project owns its UI components
**Status:** accepted (2026-11-09)

Phase 5 planned a versioned `@facilis.dev/blocks` supply chain (DataTable, ResourceForm, AuthGuard, …),
block discovery over `node_modules`, and a `RoleAssignment` block; the package in the repository
was only a 29-line type skeleton, and no workspace package, template or generated project
referenced it. The direction changed twice since: D-121 removed the `blocks` config section because
the generated project no longer composes external UI packages, and the v2 frontend (D-090/D-096)
copies Base UI primitives into `src/components/ui` as source the project owns, with the AI writing
pages against that source (docs/FRONTEND.md). A registered block supply chain has no consumer left.

**Decision.** Retire the phase and delete the artifact:
- delete `packages/blocks` and its lockfile importer; `scripts/dev/vendor-facilis-deps.sh --all`
  no longer packs it, and no source imports it;
- SPEC §4/§5.4 drop the package; §12 replaces the Phase 5 plan with a tombstone that keeps the
  number, so Phase 6/7 and the `Phase 5` references in this log keep their identifiers;
- the Phase 7+ "Block marketplace" backlog item, the Phase 6 `add-block` how-to page, O-004 (block
  discovery) and the README status row go with it; O-004 closes as *not needed*;
- the manifest `blocks` slot, the `BlockManifest` type (§7.2/§7.3) and validator rule 7 stay as a
  reserved, always-empty guard, following D-121: dropping them changes the manifest wire format
  and the 17-rule numbering, so that is a manifest revision, not a plan change.

**Rejected.** Keeping the skeleton "for later" (dead code and a plan that promises a supply chain
nobody builds); renumbering Phase 6/7 to 5/6 (churn across the spec, README and this log for no
reader benefit); building the blocks anyway (they would duplicate the copy-in primitives D-090
chose over a component package, and the AI already writes those pages directly).

**Consequences.** One workspace package fewer; the manifest `blocks` section is now permanently
empty, and rule 7 rejects any `@facilis.dev/blocks` import as an unknown block (rule 12 would also fail
it, since the package is not installed). No user-facing behaviour changes.

**Verification.** `pnpm lint`, `pnpm typecheck`, `pnpm test` (19 workspace tasks; IDE 981, analyze 82,
nitro 354) and `pnpm build` (11 packages) pass with the package removed. No source imports it;
`grep` finds `@facilis.dev/blocks` only in this log, the spec's reserved notes, the validator's guard
constant and its test fixtures.
