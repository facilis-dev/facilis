# D-096 — `@facilis.dev/ui` is removed: there is no v1 kit to support
**Status:** accepted (2026-11-06)

D-055 made the v1 kit the generated app's UI when a generated project had no CSS framework and a
tarball was the only way to ship components. D-090 replaced that for new projects: template v2 is
Tailwind CSS v4 + Base UI with shadcn-style source copied into the project, which the project owns
and edits. Keeping the old kit alive bought nothing except a package, two example apps, a vendoring
step and documentation that still presented it as the fallback — and there is no v1 project to
support.

**Decision.** Delete `@facilis.dev/ui` and everything that existed to exercise or ship it.

- `packages/ui/` is gone, with its `theme.css` contract and its `.fc-*` rules.
- Its two example apps are gone: `examples/ui-gallery` (the kit gallery) and
  `examples/design-lab` (the theme/direction exploration). `examples/todo-app` is the only
  example, and it uses the copy-in components.
- `scripts/dev/vendor-facilis-deps.sh` no longer packs it (the IDE's template tarball set,
  `TEMPLATE_PACKAGES`, already excluded it), and the AI probe prompt no longer tells the model to
  import it.
- `docs/BASE-KIT-CONTRACTS.md` is deleted. `docs/SPEC.md` §5.7 marks the kit removed and keeps the
  v1 description only as history; `README`, `AGENTS`, `FRONTEND` and the todo app's comments stop
  presenting it as a fallback.
- The generated-project tests keep the guard (no UI-kit tarball in a project's `package.json`),
  now stated without a package name.

**Rejected alternatives.** *Keep the package but stop documenting it*: a package nothing generates
still has to build, be maintained and be tested, and it stays a fallback in the decision log.
*Keep the gallery as a design tool*: the design lab existed to pick the direction; the direction is
now in `styles.css` and the site.

**Consequences.** The workspace shrinks by a package and two examples, and the vendored tarball set
loses an entry; no project can import the kit any more. Projects created before D-090 are not
migrated. The UI story is one stack: template v2's copy-in source.

**Verification.** `pnpm install` prunes the workspace, no workspace package depends on
`@facilis.dev/ui`, and `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` run without it.
`grep -r "@facilis.dev/ui"` over the tree returns only historical ADR/SPEC prose.
