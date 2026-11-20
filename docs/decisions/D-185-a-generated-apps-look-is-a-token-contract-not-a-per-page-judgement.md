# D-185 — A generated app's look is a token contract, not a per-page judgement
**Status:** accepted (2026-11-14)

**Context.** The prompt's twelve rules cover API, schema, i18n and security; none covers
appearance. The v2 template (D-062/D-090) shipped 18 colour roles, one radius and `shadow-sm`,
and the AI sees neither `styles.css` nor `components/ui/` — visual facts reach it only if it
asks. Measured defects: canvas and card at ΔL ≈ 3% under a 3px shadow, `--accent` at 3.3:1 with
white, one elevation for every overlay, no label step, no mono, no `success`/`warning`. Rule 5
also told the model to "use the existing blocks" after the block package was retired (D-131).
The archived v1 proposal ([archive/DESIGN.md](./archive/DESIGN.md), direction A) had already
described the right direction; it never reached template v2.

**Decision.** The visual system is [DESIGN.md](./DESIGN.md), enforced as tokens plus a prompt
block, not as prose:

- direction **Institutional Minimal**: bone canvas, white cards with a 1px inset highlight, 6px
  radius, four elevations, one accent, an 11px label step, `tabular-nums` figures;
- complete token set: shadow scale, `text-2xs`, `tracking-label`, `font-mono`,
  `display-font`, `success`/`warning`, `chart-1..5`, `container-page`;
- two presets as complete variable sets (D-044), `institutional` (default) and `editorial`,
  differing only in values;
- **motion is CSS-only** — six recipes (enter, enter-stagger, lift, draw, shimmer, pop-in). A
  patch cannot add a dependency and a preinstalled library would tax every WebContainer install,
  so no Motion/Lottie/Rive/GSAP; View Transitions are deferred;
- the AI gets a twelve-bullet `DESIGN_PROMPT`, a project `DESIGN.md` injected like
  `AGENTS.md`, a reference list → detail → chart section, and non-blocking design warnings.
  Rule 5 is rewritten to name components instead of blocks. No new validator error.

**Consequences.** Existing projects keep the old look, because the template is copied at
creation; migration is opt-in and out of scope. The template gains one dependency,
`@fontsource-variable/geist-mono`; `package.json` stays unwritable by patches, so the AI can add
neither fonts nor motion libraries — the CSS layer is the only path, by construction.
`--accent` changes meaning from a second green to a tint, so the active `NavLink`
(`bg-accent/10 text-primary`) keeps working but stops competing with the primary action.
`SPEC §9.2` gains the design block when P1 lands and `PATTERNS.md` stops being a draft at P2.
Contrast floors are part of acceptance (DESIGN §7): the accent/white pair moves from 3.3:1 to at
least 7:1.
