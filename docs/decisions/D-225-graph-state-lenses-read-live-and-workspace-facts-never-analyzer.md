# D-224 — Graph state lenses read live and workspace facts, never analyzer diagnostics
**Status:** accepted (2026-11-26)

**Context.** Phase 1 (D-219, D-220) gave the graph lenses backed by analyzer diagnostics: a code
from `@facilis.dev/analyze`, mapped once in `ide/src/facilis/graph-surface/lenses.ts` to an i18n key, a
short label and a semantic colour token. Epic #196 adds four lenses whose facts are not static
analysis at all: per-route request samples from the dev-only client (D-200), the working tree against
the D-181 checkpoint, the declared roles in `Analysis.config` (`ConfigFacts`), and
`PrerenderEligibilityFact`. Without a contract each lens would carry its own facts and its own way of
turning them into a sentence, and the "codes, not prose" rule (D-043) would break the first time a
live sample needed words.

**Evaluation.**

- *Extend `GraphDiagnostic`.* Tempting for uniformity, and wrong: a diagnostic is the analyzer's
  verdict on a source tree, while a request sample and a git diff are observations of a running or
  edited project. Folding them into `graphDiagnostics` would make two analyses of the same tree
  disagree, and would let a lens claim the analyzer said something it never did.
- *A rendering path per lens.* Rejected: the bar, banner, legend, answer list and callout are generic
  already; what actually differs between lenses is the source of the facts and when it may run.
- *Live lifecycle.* The D-200 client is dormant until enabled and its buffer is meaningful only while
  somebody is watching, so activation belongs to a lens opening, not to IDE boot — and deactivation
  must drop the buffer so a reopened lens never shows traffic nobody asked for.
- *Deleted nodes.* A deletion has no analyzer node. Guessing a lane for the tombstone would move the
  map, so a tombstone reuses the cached position (D-126) and, without one, is listed rather than
  placed.

**Decision.**

1. **Source taxonomy.** Every lens declares one source: `static` (analyzer diagnostics),
   `live` (runtime samples, dev-only), `workspace` (working tree versus the checkpoint) or
   `declared` (configuration and prerender facts). The taxonomy is a closed union.
2. **Fact shape.** A state lens normalises its own facts to `{ code, params, nodeId }` plus an
   optional numeric payload (counts, rates, percentiles); the text is always
   `t(messageKey(code), params)`. State codes use the `state.<camelCase>` form and resolve to
   `projectGraph.surface.state.<camelCase>` keys, so the mapping stays mechanical.
3. **No synthesis into `GraphDiagnostic`.** Analyzer diagnostics remain the analyzer's; no live,
   workspace or declared fact may enter `graphDiagnostics` or mutate it.
4. **Lifecycle belongs to the lens.** Opening a lens calls `activate()` on its source; closing,
   switching, unmounting the surface or changing the project calls `deactivate()`. Activation is
   idempotent, a `static` source's hooks are no-ops, and a live source drops its buffer on
   deactivation.
5. **One registry, one mapping.** The lens registry holds `id`, `source`, `codes`, `titleKey`,
   `descriptionKey`, `legend` and colour tokens for every lens; a code belongs to exactly one lens,
   and components never inline prose or a palette value (D-043, D-044). One lens is active at a time.
6. **No layout participation.** No state fact adds, moves or removes a node from layout. A
   "deleted" node is an overlay at its cached position (D-126) or appears only in the answers list.
7. **Unavailable is a code.** "Project not running", "no traffic yet", "clean tree", "no roles
   declared" and "no prerender fact" are codes with `en`/`it` keys, rendered like any other
   explanation; a lens never shows a blank panel instead of a reason.

**The four lenses, their sources and their first codes.**

| Lens | Source | Codes |
| --- | --- | --- |
| `runtime` | `live` | `state.notRunning`, `state.noTraffic`, `state.routeErrors`, `state.slowRoute` |
| `changes` | `workspace` | `state.noChanges`, `state.fileModified`, `state.fileAdded`, `state.fileDeleted` |
| `reach` | `declared` | `state.noRoles`, `state.publicRoute`, `state.undeclaredPermission`, `state.wildcardRole` |
| `prerender` | `declared` | the analyzer's `PrerenderIneligibilityReason` codes, plus `state.prerenderUnknown` |

**Consequences.** A new lens costs one registry descriptor, one lifecycle adapter and one en/it key
pair; it never touches the bar, the banner or the answer list. Because live and workspace facts stay
outside the analyzer, an analysis remains a pure function of the tree, and the graph's diagnostic
answers keep matching what `@facilis.dev/analyze` reports. The cost is a second fact vocabulary in the
IDE (`state.*`) that the registry must keep disjoint from analyzer codes — enforced by a unit test
that enumerates both sets.
