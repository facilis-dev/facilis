# D-137 — System-only is a class: named in the graph, refused in a route's dbTables
**Status:** accepted (2026-11-10)

D-136 made "no RLS" mean system-only. Two surfaces still treated it as a defect: the project graph
painted the no-RLS table badge amber ("no RLS") next to the green "RLS", and a route could declare
`dbTables: ["roles"]` even though `facilis_app` has no privilege on that table — the query would
fail closed with `permission denied` at runtime while the graph drew the edge as a normal one.

**Decision.** The project graph and the Data Explorer label the second class **system-only**, in a
neutral colour: it is a legitimate classification, not a warning. The analyzer gains one diagnostic,
`route-system-table`: a route that declares a system-only table in `dbTables` (or as the table
side of `dbColumns`) is reported. A table named in the route's audited elevation `tables`
(`ctx.sudo`/`ctx.system`) is exempt — that elevation is the only legal access (D-099/D-136).

**Why a warning, not a gate error.** An elevation's table list is a static fact only when it is a
literal array; `tables: loadTables()` is recorded as unknown, and a route that is actually correct
must not fail CI because the analyzer cannot read the array. The runtime already fails closed, so
the diagnostic is the discoverable form of that failure — it shows in the graph's diagnostics
footer and in CI as a warning.

**Consequences.** The i18n key `projectGraph.noRls` becomes `projectGraph.systemOnly`
("system-only"/"solo sistema"); `dataExplorer.rls.rls_off` shows the same label while
`rls_off_scoped` keeps the red defect styling. No runtime, schema or contract change beyond the
diagnostic: a system-only table stays unreachable from route code and the fix is to move the access
into an elevation, not to enable RLS on a table that should not be app-visible.

**Rejected.** Making the diagnostic an error (fails a correct route whose elevation tables are
dynamic); suppressing the warning when any elevation exists (the elevation may name other tables);
turning the graph badge red (system-only framework tables are normal, and a red badge would train
people to ignore it).

**Verification.** `@facilis.dev/analyze` `src/passes/route-tables.test.ts` (declaration warns, the
literal elevation exempts, `dbColumns` counted, unknown table silent); analyzer suite 15 files/93
tests; IDE i18n catalog tests, graph tests, typecheck and lint.
