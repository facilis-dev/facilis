# D-044 — Themes are complete variable sets; components only name roles
**Status:** accepted (2026-10-31)

D-043 required every surface to work in both themes; leaving that to `dark:` pairs per element
made each new theme a cross-component edit. The Studio therefore adopts the daisyUI-style split:
**a theme is one block of role values; a component only names roles.** Adding a theme means a new
`[data-theme="…"]` block in `ide/src/index.css` plus one entry in `ide/src/ui-themes.ts` — not a
component change.

**The roles** (each defined once per theme block, mapped into Tailwind via `@theme inline`):
the shadcn set already in use (`background/foreground`, `card`, `popover`, `primary`,
`secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*),
plus the IDE chrome roles this decision adds — `chrome`/`chrome-foreground` (tab strips,
toolbars), `editor`/`editor-foreground` (editor pane), `panel`/`panel-foreground` (terminal,
preview body), `overlay` (DevTools surface), `brand`/`brand-foreground` (status bar, active-tab
marker), `checker` (transparent-image checkerboard), and the status roles
`info`, `success`, `warning` (+ their `-foreground`). Except for brand marks (SVG logos in
`templateIcons.tsx`) and scrims (`bg-black/10` on dialogs), no component may contain a hex or a
raw palette class; the smoke run catches CSS parse/utility errors, and review catches a stray
literal.

**Mechanism.** next-themes writes `data-theme="facilis-light|facilis-dark"` on `<html>`
(`attribute="data-theme"`; the pre-paint script in `ide/index.html` applies it before first paint).
The Tailwind `dark` variant is bound to that attribute, `color-scheme` is declared in each block,
and `ui-themes.ts` maps a theme name to its attribute and to the appearance Monaco/xterm follow
(`appearanceOf`). xterm's base colours read `--panel`/`--panel-foreground` at apply time, so the
terminal follows a new theme too; its ANSI palette remains a per-appearance resource.

**Consequences:** a future theme (e.g. a midnight or high-contrast variant) is a CSS block + one
registry entry + a palette row; both the current themes are visually unchanged because the new
roles were initialized with the values that used to be hardcoded per component.
