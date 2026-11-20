# D-174 — The project graph names the system-only class, not the default RLS
**Status:** accepted (2026-11-12)

**Context.** The graph card and the table inspector carried an "RLS" badge on every app-scoped
table. RLS is structural: every app table enables row-level security and its policy set is what
grants `facilis_app` access, with a restrictive `tenant_isolation` gate mandatory on all of them
(D-008/D-136). The badge therefore repeated the default on every card. The owner asked to remove
it: "Dal grafo rimuoviamo RLS se è presente solo 'tenant isolation'".

**Decision.** The graph shows no RLS badge at all and names only the exception, the
**system-only** class (a table without RLS, D-136), in the neutral colour of D-137. The table
inspector keeps the full policy list, `tenant_isolation` included, because there the policies
are the fact, not a summary; the scope line and the analyzer facts are unchanged.

**Why not hide it only for tables whose policy set is exactly `tenant_isolation`.** That
condition would hide almost nothing: Postgres denies by default when RLS is on, so every
reachable app table needs a permissive policy beside the mandatory restrictive tenant gate
(owner, role, `EXISTS`, a tenant-access gate — D-008). "More than `tenant_isolation`" is the
normal case, not the exception, so the badge would stay on every real card. RLS-on is the class
default, hence not news.

**Consequences.** A default-scoped card is silent; system-only tables stay named. No runtime,
schema, policy, analyzer-fact or diagnostic change, and the Data Explorer's live RLS badge is
untouched.

**Verification.** `pnpm --filter @facilis.dev/ide typecheck`, `pnpm --filter @facilis.dev/ide test`
(152 files / 1270 tests, unchanged model), `pnpm lint`, `pnpm build`. The badge is a JSX
conditional and component behaviour has no test harness, consistent with D-171/D-173.
