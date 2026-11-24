# D-206 — The Run and Debug panel is hidden until the vendor debugger covers Vite SSR code
**Status:** accepted (2026-11-20)

Renumbered from an inline `D-201` entry in `docs/DECISIONS.md` (2026-11-24): that number
collided with the assigned `D-201` (`db/migrations` is retired everywhere) and violated the
one-file-per-decision rule. The content is unchanged; only the ID moved.

**Context.** The IDE's breakpoint debugger (Vivari's source-instrumented CDP debugger,
`VV_DEBUG`) instruments only the guest require-loader path (`runtime/module.js`). The
Facilis backend is Nitro v3 running as a Vite plugin inside `vite dev`: Vite evaluates
SSR-transformed route modules through its ModuleRunner (`AsyncFunction`), which no debug
hook covers, and `node_modules` is excluded from instrumentation. Breakpoints in server
routes therefore never bind, and the panel renders them as set with no feedback — a silent
no-op for the one surface we care about (backend debugging). Diagnosis and design options
are filed on the fork: kele23/vivari#5.

**Decision.** Hide the Run and Debug panel temporarily, IDE-side only, behind one
availability flag (`ide/src/facilis/debug-panel-flag.ts`, `DEBUG_PANEL_ENABLED = false`):
the activity-bar entry, the sidebar panel branch, and the Monaco gutter wiring (glyph
margin + `attachEditor`) are gated. The `DebugSession` machinery stays in place, inert
(no debug-mode toggle → no `VV_DEBUG` → no targets). No vendor edit (D-030). Backend
debugging meanwhile follows the sanctioned D-119 path: structured `access`/`error`/`app`/
`audit` logs with `requestId`, read by the Logs view.

**Consequences.** The panel returns by flipping the flag once kele23/vivari#5 lands
(acceptance: a breakpoint in an SSR route's source pauses at the correct line with locals).
The `activity.debug` i18n keys stay registered; the tour's activity-bar copy drops the
hidden surface from its list (en + it). Bind feedback for unbound breakpoints
(`setBreakpointByUrl.locations`) remains an IDE-side improvement to make when the panel
returns.
