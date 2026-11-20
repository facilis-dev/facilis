# D-060 — One stylesheet per component, theme.css only tokens + global
**Status:** accepted (2026-11-01)

Owner feedback after reviewing the promoted kit: a single stylesheet holding every component's
rules is hard to navigate and maintain. Each component now owns its styles.

**Decision.** `src/<component>.css` sits next to `src/<component>.tsx` and the module imports
it (`import "./button.css";`); shared visual atoms live in small partials imported by the
components that use them (`icon-button.css`). `theme.css` keeps **only** the Geist `@import`,
the three complete token sets and the global base layer (reset, body, links, global focus
ring) — no `.fc-*` component rules. The build runs `tsc` plus `scripts/copy-css.mjs`, which
copies every stylesheet into `dist/` so packed tarballs (D-023) resolve CSS next to the
compiled JS; `src/` and `theme.css` still ship for copy-paste. `css.test.ts` enforces that
every styled component imports its stylesheet, every stylesheet is imported, `theme.css` has
no component rules, and component CSS contains no colour literals and only tokens defined in
`theme.css`.

**Consequences:** adding a component means the module, its stylesheet and a test; copy-pasting
a component brings its CSS; the CSS bundle carries a little deliberate duplication but stays
organised. This is the structure new components and the IDE template follow.
