# D-042 — The controller is a facade; each subsystem is a session object
**Status:** accepted (2026-10-31)

`IdeController` (`ide/src/vv/controller.ts`) is the pinned file D-019's ratchet lets only shrink,
yet every new Studio panel would otherwise edit it. The split follows the shape upstream already
uses for `DebugSession`/`ScmSession`: a self-contained subsystem is a class that owns its state
and talks to the controller through a small host interface (`SearchHost`, `PreviewHost`,
`PreviewView`), while the controller keeps the single snapshot store, the project/port bookkeeping
and the status bar.

Rules that keep each step mechanical and reviewable: one subsystem per commit; the public call
sites stay the same (thin delegations, or `c.preview.<method>()` in the panels); logic that can be
tested without a browser moves to a helper module with a vitest file (`preview-url.ts`); the
ratchet entry is lowered in the same commit. Done so far: language/path helpers,
`memory-probe.ts`, `file-tree.ts`, `search-session.ts`, `preview-session.ts` +
`preview-devtools.ts`, `terminal-session.ts` + `terminal-theme.ts`, `project-export.ts` +
`project-import.ts` (with `synthesizeManifest` unit-tested), the editor language layer
(`editor-language.ts`, `editor-deps.ts`, `editor-python.ts`) and the editor session
(`editor-session.ts`: Monaco mount, status readouts, actions). Still to extract: the editor
model/tab layer, the project open/run lifecycle and Explorer file operations.

**Consequences:** a new panel calls a session (`c.preview.addPreviewTab()`) instead of growing the
controller, and the baseline entry keeps ratcheting down (4,294 → 2,518 lines so far). The split
is not a behaviour change: it is guarded by the same smoke suite (`pnpm ide:smoke`, the React
template and multitab) plus `preview-url.test.ts` for the pure preview helpers.
