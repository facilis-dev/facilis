# D-075 — The IDE's visible brand is the facilis.dev logo; the title is not a text string
**Status:** accepted (2026-11-01)

D-069 settled the product's name but kept "Facilis Studio" as the visible text in the title
bar and the document title. The logo ([`brand/`](../brand) — black and white, wordmark
`facilis.dev`) is the brand, and the name the product answers to is the site itself.

**Decision.** The title bar renders the logo lockup (`ide/public/facilis-lockup.svg`, a
single-ink mask painted with `currentColor` via `.brand-lockup` in `ide/src/index.css`) in
place of the text title; the button's accessible name stays in the catalogue (`app.name`, now
`facilis.dev`). The document title is `facilis.dev`, or `<project> — facilis.dev`; the static
`ide/index.html` title and meta description say `facilis.dev`. D-069's provenance rules are
unchanged: the Vivari name survives only in attribution, package ids and the `__vv*`
internals.

**Consequences.** The brand is one vector asset for both the tab (favicon) and the chrome, and
it follows the theme without a per-theme copy. `Facilis Studio` no longer appears in
`ide/src` or `ide/index.html`; it survives only in the architecture diagrams
(`README.md`, `docs/SPEC.md`) and this decision log, where it describes the app rather than
labelling it.
