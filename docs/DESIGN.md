# Facilis design direction

**Status:** proposal for review (2026-10-31). The current kit reads dated ("Bootstrap 3"):
system font, flat grey-on-grey surfaces, 1 px borders, no elevation, no type hierarchy and no
page patterns. The fix is a **design layer** (tokens + composition + designed examples), not more
component props: components stay small and copyable (D-047).

This document is intentionally self-contained: it describes the visual language on its own terms,
not by naming external products.

## Two layers, one system

The kit has to cover two jobs without becoming two libraries:

- **Operations layer — the default for generated apps.** Institutional, data-first, calm: an
  app shell with sidebar and breadcrumb/topbar, dense tables, filters, tabs, utility cards with
  hairline borders, one strong signal accent, clear forms. Used by every app screen, light and
  dark.
- **Brand layer — auth, onboarding, empty states, public pages.** Expressive: deep near-black
  surfaces, a vivid gradient accent, bigger type, more air, a restrained glow. It is a **scoped
  theme** (a section or a screen), never the default for a data table.

**Both layers ship complete light AND dark sets — four theme blocks:** `operations-light`,
`operations-dark`, `brand-light`, `brand-dark`. The brand layer is **not dark-only**: a light
auth screen keeps its character (soft lavender/white surfaces, violet accent, light brand
gradient) instead of falling back to the operations theme. The user's theme choice applies to the
brand layer too.

Same components, same roles; the difference is which complete variable set is in scope. That is
the D-044/D-047 thesis applied beyond light/dark.

## Principles

1. **Calm, precise, operational.** Daily internal tools: clarity over decoration.
2. **Hierarchy before colour.** Weight, size and space carry structure; colour is an accent and a
   status signal, never the main character.
3. **One signal accent, semantic status.** Success/warning/error only in badges, dots and short
   messages — never full-row fills.
4. **Surfaces, not boxes.** Canvas → card → overlay: hairline border + one subtle shadow; the
   brand layer may use a gradient/glow in its own surfaces.
5. **Density with air.** 4/8 spacing grid; compact tables, generous section spacing.
6. **Dark mode designed at the same time.** Both sets complete; no inversion hacks.
7. **Motion is feedback.** 120–160 ms ease-out, visible focus ring, reduced motion respected.
8. **Small API, rich surface.** Visual richness lives in tokens and composition; deep
   customisation is still "copy the component".

## Typography

Geist Variable as the single family (already used by the IDE), weights 400/500/600; mono for
numbers in tables and code. Scale: 11 label (uppercase, +0.08em) · 12 meta · 13–14 UI/body ·
16 lead · 20 h3 · 24 h2 · 30–32 h1. Headings −0.015/−0.02em, tabular numbers in data views.

## Tokens (proposal)

Existing roles stay: `--color-base-100/200/300`, `--color-base-content`,
`--color-primary|secondary|neutral|info|success|warning|error` (+ `-content`),
`--radius-selector|field|box`, `--border-width`. Added design-layer tokens:

| Group | Tokens |
|---|---|
| Type | `--font-sans`, `--font-mono`, `--text-xs…2xl`, `--leading-tight|normal`, `--tracking-tight` |
| Space | `--space-1…12` (4 px base), `--page-max` |
| Density | `--control-h`, `--row-h`, `--pad-card`, `--pad-page` |
| Elevation | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| Focus | `--ring-width`, `--ring-offset` |
| Motion | `--duration-fast`, `--duration-slow`, `--ease-out` |
| Shape | `--radius-pill` |

A theme is a **complete variable set**; the lab proves a token-only switch changes the whole feel.

## The three directions for the lab

Same four screens, tokens only; each direction renders light and dark.

**A — Institutional (recommended for app screens).** Light-first; canvas `#f7f8f9`, surface
`#ffffff`, border `#e2e5e9`, text `#0f172a`, muted `#5f6b7a`, primary forest green
`#15803d` (white content), signal accent `#16a34a` (focus ring, active states, links in
context); dark canvas `#0b0d10`, surface `#14171a`, border `#2a3038`, text `#f4f5f7`,
primary `#4ade80` with dark content `#052e16`, signal accent `#22c55e`. Success stays in the
green family but only appears in badges/dots with a label, so it never competes with a primary
action. Radius 8/12, subtle shadows, control 38 px / row 44 px, sidebar 248 px, page max 1280 px.

**B — Platform (brand layer). Light and dark are both first-class.**
Dark: canvas `#13111c`, surface `#1a1626`, raised `#221a33`, border `#2f2740`, text
`#f5f2f7`, muted `#a89fb5`, primary violet `#8b5cf6`, brand gradient
`#16093b → #2c0a5c → #5e084d`. Light: canvas `#faf9fe`, surface `#ffffff`, raised
`#f2eefb`, border `#e5def2`, text `#1a1626`, muted `#6b6478`, primary `#6d28d9`, brand
gradient `#f3e8ff → #ede9fe → #fbcfe8` with dark text. Radius 10/14, soft glow on primary/brand
surfaces, control 38 / row 46. The auth split brand panel is the showcase in both appearances.

**C — Premium (brand layer alternative). Light and dark are both first-class.**
Light: canvas `#f6f3ee`, surface `#fffdfa`, border `#e6e0d5`, text `#14130f`, muted
`#6f675c`, primary green `#3f6b4d`, accents champagne `#ecd39a` / bronze `#b08d57` /
powder blue `#84b3cf`. Dark: canvas `#0a0a0a`, surface `#141414`, border `#2a2a2a`, text
`#f2eee6`, muted `#a59f94`, primary `#8fb99a`. Radius 10/16, almost no shadows (finish from
borders and space), control 40 / row 50, editorial headings.

**Recommendation:** A (green accent) is the app default; B (violet, light + dark) is the brand
layer used by auth/onboarding/empty states, with C (warm editorial, light + dark) as the
alternative. The lab shows all three so the choice is visual, not theoretical.

## Patterns to add after the choice

1. `AppShell` (sidebar/topbar slots), `Card`, `StatCard`, `Tabs`, `Dialog`, `DropdownMenu`,
   `Avatar`, `Pagination`, `TableToolbar`, `Skeleton`, `Switch`.
2. `Tooltip`, toast polish, `CommandMenu`, date picker, file upload.
3. `DataTable` (TanStack) on the table pattern, with the block manifest.

Each stays small, token-driven and copyable; the API surface grows by pattern, not by prop.

## Design lab

`examples/design-lab`: the same four screens (auth, dashboard/projects, detail/form, settings)
in A/B/C, light and dark, switchable. Mock data + client-side interactions: it exists to choose
the visual line, not to ship. After the choice: tokens move into `@facilis/ui/theme.css`
(operations + brand theme blocks), primitives are polished against them, then the patterns land
one by one.

## Decision needed

Use A (green) as the app base; choose B (violet) or C (warm) as the brand layer — each in light
and dark. Then the kit gets the chosen tokens + brand theme, and the gallery and todo app are
restyled as the first acceptance.
