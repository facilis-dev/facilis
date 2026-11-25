# D-212 — In-place graph lenses use analyzer diagnostic codes resolved via i18n
**Status:** accepted (2026-11-25)

**Context.** D-211 fixes the map-and-lens direction: lenses are in-place highlights, never
separate modes, and the graph's messages obey "codes, not prose". Child #189 is the contract
child of epic #182. Before it, the preview answered Q4/Q5/Q9/Q17 with hardcoded English strings
inside the canvas bundle, which meant a new locale touched analysis code and the answer list
could drift from the analyzer's facts. The IDE also had no per-node diagnosis: selecting a
flagged node opened the generic inspector with no explanation of why the lens flagged it.

**Evaluation.**

- *Where the facts live.* Deriving the flags in the IDE would duplicate the analyzer's
  permission/RLS/elevation rules and its domain grouping. The analyzer already owns those
  facts, so it emits the diagnostics; the IDE only groups and renders them.
- *Code shape.* A diagnostic is a stable code plus structured params (`method`, `table`,
  `count`, `domains`). No message, no severity and no locale cross the package boundary. The
  IDE's `lenses.ts` is the single mapping from code to i18n key, short label and semantic
  colour token; `t(code, params)` interpolates, so an en/it switch re-translates the banner,
  the answer list and the callout without a reload.
- *Lenses over screens.* Flagged nodes keep their layout rect and camera; the canvas rings and
  badges them while dimming the rest. The overview adds a per-domain flag count. Toggling a
  lens changes draw state only, never the layout fingerprint.
- *Explicit zero.* #146 was a silent no-op. An active lens with no matches now renders a named
  empty state with the way out, and Escape clears the lens layer (after selection, before
  leaving detail), so the #187 ladder keeps its order.
- *Navigation.* Answer rows and diagnosis callouts reuse the #187 selection/drawer/jump path;
  a lens never invents a second navigation mechanism.

**Decision.**

1. `@facilis.dev/analyze` exports a `graphDiagnostics` fact set on `Analysis` and
   `buildGraphDiagnostics`: codes `publicWrite {method}`, `publicAdmin {}`,
   `tableNoRls {table}`, `elevated {}`, `shared {count, domains}` and `unknown {}`, each with
   a `nodeId`. Facts are sorted by node id then code, so counts and answer lists are stable.
2. The analyzer emits no user-facing prose. Codes are a const-typed union in
   `packages/analyze/src/graph-diagnostics.ts` and are exported through the package entry.
3. The four lenses are security (publicWrite/publicAdmin/tableNoRls), elevated (elevated),
   shared (shared) and unknown (unknown). `ide/src/facilis/graph-surface/lenses.ts` owns the
   code -> key, code -> label and code -> colour-token mappings; components never inline
   prose or palette values.
4. The active lens shows a banner with title, description, legend and flagged-node count, the
   per-domain flag badges in the overview and a clickable answer list. Selecting a flagged
   node shows every diagnostic for it in the drawer callout.
5. Escape clears the active lens as its own layer; the lens close control does the same. The
   canvas layout and camera are not inputs to the lens and are never mutated by it.

**Consequences.** A new diagnostic code needs one analyzer entry, one `lenses.ts` mapping and
one en/it key pair; a new locale is a catalogue change only. The security lens and the
inspector now share the same facts, so a rule change cannot diverge between them. The cost is
an extra derived fact set on every analysis and a duplicated domain-grouping pass inside the
analyzer (it mirrors the surface's grouping for `shared`); both are pure and bounded by the
graph size.
