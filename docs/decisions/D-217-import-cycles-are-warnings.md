# D-217 — Import cycles are warnings
**Status:** accepted (2026-11-25)

`createModuleGraph` already resolves the project's import/re-export edges for binding lookups,
so a cycle is cheap to find without executing anything. Cycles hurt boot order and bundling in
generated projects, but they do not break the running app and the shipped examples are free of
them: the epic asks for an additive early-warning layer, not a new runtime rule (epic 168 design
rule 1). No AI validator rule ships initially, so the validator stays at 23 rules and SPEC §9.3
is unchanged.

**Decision.** Report analyzer diagnostic `import-cycle` (warning) once per strongly connected
component (SCC) of the project-internal static import graph, listing a representative closed
path. Framework and `node_modules` overlays are excluded. A self-import is a one-node cycle and
is reported. Additive: no runtime boundary changes and rollback is the removal of the pass.

**Mechanism.**

- `packages/analyze/src/import-cycles.ts` computes the graph. Nodes are `graph.files` minus
  `node_modules/`; edges come from `buildFileFacts`' static imports, side-effect imports and
  re-exports (dynamic `import()` and `require()` are deferred and create no load-order cycle),
  resolved with `graph.resolve`. A target outside `graph.files` or under `node_modules/` is
  dropped, so framework source merged by the IDE (D-130) never becomes a project finding.
  Edges are deduped per target and sorted; Tarjan runs iteratively (a long chain must not
  overflow the stack) over nodes in path order; components are sorted by their first path; the
  representative cycle is a BFS shortest path from the lexicographically smallest member back
  to itself. The output is deterministic for a given file map.
- `packages/analyze/src/passes/import-cycle.ts` turns each SCC into one warning. The source is
  the import/re-export site that opens the path (a file and line on the cycle). The message
  names the component size and lists the path; `MAX_CYCLE_PATH_ENTRIES = 8` caps the listed
  entries (the closing repeated file included) and the remaining segments are counted, so a
  large knot stays one readable line.
- `analyzeProject` runs the pass after the route passes and appends the result to
  `Analysis.diagnostics`; the existing `node_modules` diagnostic filter leaves it untouched
  because every node is project code.
- A self-import (`a.ts` importing `a.ts`) is the one-node component whose only edge is the
  self edge; it is reported with a `self-import` subject instead of being ignored: it is still a
  load-order defect and the message makes the one-file cycle obvious.

**Rejected.** One diagnostic per edge or per two-file pair: the SCC is the unit a fix must
break, and per-edge warnings would be noise for a knot of files. An AI validator rule in this
child: the issue scopes the first ship to a warn-only diagnostic, and the validator is 23 rules.
Reading only `module.imports`: that list has no side-effect imports (`import "./b.ts"`), which
are real load edges. Reporting `node_modules`/framework cycles: shipped code the project cannot
fix. Recursive Tarjan: an import chain is unbounded input. Listing only the sorted SCC instead
of a real path: a closed path proves the cycle and is actionable, and the cap keeps it
readable. Failing the CI gate on a warning: a cycle does not break the build, so the gate
asserts warnings-only and reports the count.

**Consequences.** A project with a cycle sees one warning per SCC in `Analysis.diagnostics` (IDE
diagnostics, patch feedback) and nothing blocks the build. The listed path is one representative
cycle, not every cycle inside the component, and it can move when imports change. Cycles
through dynamic imports stay invisible by design. Rollback removes the module, the pass, the
`analyzeProject` wiring and the SPEC sentence.

**Verification.** `packages/analyze/src/passes/import-cycle.test.ts` (A→B→A warns once and
names the path; acyclic graph silent; self-import warns; framework overlay with a self-re-export
ignored; independent components ordered by path; a 12-file cycle capped with the hidden count);
`packages/analyze/src/import-cycles-gate.test.ts` (cyclic fixture, acyclic fixture, framework
overlay ignored, shipped `examples/*` apps warn-only with zero cycles); `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build`.
