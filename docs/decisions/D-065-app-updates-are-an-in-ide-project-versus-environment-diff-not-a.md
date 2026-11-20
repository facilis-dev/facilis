# D-065 — App updates are an in-IDE project-versus-environment diff, not a server feed
**Status:** accepted (2026-11-01)

Generated projects outlive the build that created them, and adopters need a simple signal:
"this app has updates to apply". A server-driven feed would reintroduce the backend the
architecture refuses (D-045 trust boundary) and would not work air-gapped.

**Decision.** Every generated project carries `facilis.app.json` (template and environment
version, lockfile hash). The running build knows its own version, so the IDE compares locally
and shows a badge plus a panel when the project is older. Upgrading applies ordered,
idempotent recipes shipped with the build, regenerates the dependency tree against the
configured registry, runs the DB migration, and rolls back on failure; the project's git repo
is the undo. In `managed`, the comparison is against the deployment's approved baseline, so
the same indicator also reports dependencies outside policy. Contract: `docs/APP-UPDATES.md`.

**Consequences:** no network needed for the check; recipes are code, reviewed with the build;
the upgrade path is bounded by the versions a build actually contains. Environment updates
stay a redeploy — the user never "updates the IDE".
