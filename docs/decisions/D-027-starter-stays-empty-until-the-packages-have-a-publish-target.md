# D-027 — `starter/` stays empty until the packages have a publish target
**Status:** accepted (2026-10-28)

SPEC §4 lists a `starter/` template that users clone. Today every Facilis project installs
`@facilis.dev/*` from tarballs the IDE serves on its own origin (D-022), and those URLs are only
reachable from inside the WebContainer. A committed `starter/` tree would declare dependencies
nobody outside the IDE can install — a copy that rots instead of a starter.

The generated tree is the reference app (`examples/todo-app`, D-062) plus the IDE wrappers in
`ide/src/facilis/`, and the IDE template is the only consumer. `starter/` gets created when
O-006 (publish target) is decided and the packages are installable by name; until then the
template payload is the single source of truth.

**Consequences:** the Phase 2 "starter" item is a publish-time task, not a UI one — the same
decision as O-006, not a new one.

**Amended by D-164:** the publish target is public npm and the packages are installable by name,
so the starter is unblocked.
