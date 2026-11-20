# D-054 — The Explorer lists git-ignored paths, dimmed; index and search skip them
**Status:** accepted (2026-11-01)

D-052 hid `.facilis` from the Explorer along with the file index and search, and the index
walk had a hard-coded skip list for `node_modules`, `dist` and friends. Hiding is the wrong
answer for the Explorer: the files exist, `ls` shows them, and a project's own `.gitignore`
already states what belongs to its source tree — but a user cannot learn that from a tree
that silently omits rows. Search is the opposite case: its results are a promise that a match
is actionable source, so ignored paths must not appear there.

**Decision.** The Explorer lists every entry except `.git` (VCS internals, which git itself
never tracks); entries matched by a `.gitignore` are dimmed through the `data-git-ignored`
attribute (60% opacity, theme-neutral). The quick-open index and full-text search exclude
them, but the rule is now the project's `.gitignore` rather than a fixed list:
`ide/src/vv/workspace-index.ts` walks each root, parses every `.gitignore` it meets (root or
nested) with the same `ignore` matcher isomorphic-git uses, and applies the per-directory
rules outermost-first so a nested file wins, exactly as git does. It yields the searchable
file list plus the two sets (`ignoredFiles`, `ignoredDirs`) the UI consults. An ignored
directory is not descended into; `.facilis` is skipped (D-052) yet still recorded as ignored,
so its contents dim. Search filters result batches on this side — the kernel's walk has its
own fixed skip list and the runtime is read-only — and recomputes the summary counts from
what survives the filter.

**Consequences:** what the Explorer shows and what search covers now agree with git, and the
project's own `.gitignore` decides both. The walk reads one `.gitignore` per visited
directory on every tree refresh, bounded by depth and file count as before, so a path outside
the bound is neither indexed nor known to be ignored. Edits to a `.gitignore` (terminal or
save) show up on the next refresh because the read is not cached. Heavy directories are still
skipped without a rule — a freshly created project may have no `.gitignore` — but they are
dimmed only when a rule actually ignores them.

**Verification.** `workspace-index.test.ts` pins root and nested rules, negation, anchoring,
directory-only patterns, the unreadable-`.gitignore` fallback and the ignored-ancestor
prefix; `search-session.test.ts` pins the batch filter and the recomputed counts;
`pnpm --filter @facilis.dev/ide typecheck|test|build`; `pnpm ide:smoke`.
