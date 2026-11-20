# D-055 — The base UI kit is plain CSS + daisyUI-style role variables
**Status:** accepted (2026-10-31); superseded for new projects by **D-090** — template v2 ships
Tailwind CSS v4 + Base UI with shadcn-style source the project owns. The kit stays as the v1 kit
for projects created before D-090, the UI gallery and the design lab.

Generated projects need a small set of base components (table, toaster, inputs, fields,
badge, alert) that a project can use, restyle or copy. The kit must work in the project the
IDE generates today — a plain Vite + React app with no CSS framework installed — and as a
tarball with no build configuration (D-023/D-032). It therefore ships as `@facilis.dev/ui`:
**plain CSS classes (`.fc-*`) plus one block of role variables**, not Tailwind utilities.
This keeps the whole component copy-pasteable (the directive's "recreate it if you need
more") and leaves Tailwind to the app for its own layout.

**Decision.** A theme is a complete variable set in `theme.css` (`:root` light,
`[data-theme="light"]`, `[data-theme="dark"]`): `--color-base-100/200/300`,
`--color-base-content`, `--color-primary|secondary|neutral|info|success|warning|error`
(+ `-content`), `--radius-selector|field|box`, `--border-width`. Components only name roles
(never a literal colour); rebranding means editing those values, adding a theme means another
`[data-theme="…"]` block. The prop surface is deliberately tiny: variants and sizes only, no
per-component colour/radius props.

**Consequences:** the kit is usable without Tailwind and works with any stack the project
chooses; `@facilis.dev/blocks` may still be Tailwind/shadcn (D-003) because it builds app screens
on top of the base kit. Deep customisation is "copy the component and its `.fc-*` rules into
the project", not a configuration system.
