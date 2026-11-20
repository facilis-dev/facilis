# D-173 — The user can dismiss the AI's project-graph focus
**Status:** accepted (2026-11-12)

**Context.** D-171 lets the model focus nodes/edges of the project graph: the panel dims everything the request does not name and fits the viewport, and an empty request is how a tool clears it. No user-facing affordance existed, so the owner could not leave the dimmed state: "Non si riesce ad uscire dal focus che si è attivato".

**Decision.** Make the focus dismissible from the panel that shows it. `clearGraphFocus()` drops any pending request and delivers the empty request (the same path the tools use), so the canvas stops dimming. `ProjectGraphPanel` clears the focus on Escape — skipped while fullscreen (the existing fullscreen listener owns that press), when the event was already handled, and while an input/textarea/select/contenteditable has focus, so the note editor keeps its own Escape. `ProjectGraphToolbar` renders a "Clear focus" control only while a focus is active, with a hint tooltip; en/it keys added.

**Consequences.** The focus stays view-only and unpersisted: closing the tab, refreshing or saving the layout still cannot leave it behind, and one Escape press has exactly one effect. A focus announced while the graph tab is closed is discarded rather than replayed once the user dismissed it.

**Verification.** `pnpm --filter @facilis.dev/ide test` — 152 files / 1270 tests, including the new `clearGraphFocus` cases in `graph-focus.test.ts` (empty request maps to null; a pending focus is discarded). `typecheck`, `lint`, `node scripts/check-file-length.mjs` and the i18n parity test pass; the toolbar wiring has no component-test harness (typecheck/lint only), consistent with D-171.
