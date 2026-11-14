# Generated-app visual system — Institutional Minimal

**Status:** accepted (D-185, 2026-11-14); implementation lands in P0–P3 (§11). This is the
contract for how a generated app **looks**; [FRONTEND.md](./FRONTEND.md) is how it is built. It
replaces [archive/DESIGN.md](./archive/DESIGN.md), the v1 kit proposal that never shipped.

Audience: the AI prompt (§10), the template author, and a developer restyling a project.

## 1. Why

The 19-rule validator and the prompt covered security, schema and plumbing; nothing covered
appearance. The v2 template shipped 18 colour roles, one radius (`0.5rem`) and one shadow
(`shadow-sm`), so "make it look good" had no vocabulary to name, and every generated page
re-derived layout, scale and states from scratch. The measured starting point:

| Measured in `examples/todo-app/src/styles.css` | Consequence |
|---|---|
| canvas `#f7f8f9` vs card `#ffffff` (ΔL ≈ 3%) plus a 3px/10% shadow | cards do not read as surfaces |
| `--primary #15803d`, `--accent #16a34a`, `--ring #16a34a` — three greens | colour ranks nothing; `bg-accent text-white` is 3.3:1, below AA |
| one elevation for card, dialog, popover | overlays do not detach from the page |
| no 11px label step, no mono | no kicker language; figures are not comparable at a glance |
| no `success`/`warning` role | the AI must write `bg-green-100` to show "done" — the token rule breaks |

## 2. Direction

**Institutional Minimal**: the finish of a professional tool (Linear, Vercel/Geist, Stripe
Dashboard), not a marketing page. Four mechanisms:

1. **The canvas is never the card.** Bone page, pure-white card, 1px border, and a 1px inset top
   highlight (`--card-shadow`). That highlight is what makes a flat card read as physical
   without glass or heavy blur.
2. **Four elevations with meaning.** `xs` control · `sm` card at rest · `md` card on
   hover/dropdown · `lg` dialog/popover.
3. **A real type scale** (§5) and `tabular-nums` on every figure.
4. **One accent.** Brand is `--primary`; focus is `--ring`; `--accent` is a **tint** (hover,
   selected row), never a second green. Status appears only in badges and dots, with a label.

Density is part of the look: 44px table rows, 36px controls, compact cards, generous section
spacing. "Minimal" means few decisions applied precisely, not empty pages.

## 3. Presets

A preset is a **complete variable set** (D-044), never component code. Two are official and share
every role name, so no component knows which is active:

| Preset | Source | Character |
|---|---|---|
| `institutional` (default) | `examples/todo-app` | bone/white, pine accent, 6px radius, sans display |
| `editorial` | `examples/showcase-app` | warm paper, serif display, 12px radius, wider rhythm |

`--display-font` is the only extra axis: it repeats the `--font-sans` value, so the default
preset costs nothing, and only `Page`'s `h1` and `CardTitle` name `font-display`. Promoting
`editorial` to a project template later means its font package, nothing else.

## 4. Tokens

### 4.1 The one rule that keeps the system working

`@theme inline` resolves a value **at build time**. Therefore every token that a theme block must
be able to override is an *indirection*: the `@theme` value points at a runtime variable, and the
variable holds the literal.

```css
@theme inline {
  --color-background: var(--background); /* runtime → the theme block wins */
  --shadow-card: var(--card-shadow);     /* runtime → dark can swap the inset highlight */
  --font-display: var(--display-font);   /* runtime → a preset can swap the display face */
}
```

A value written literally in `@theme` (a fixed shadow spread, a hex colour) is frozen and cannot
be themed. The inverse also holds: an `inline` value exists to be inlined into utilities, so a
theme block must not depend on it being available as `var()` — `var(--shadow-xs)` there is a
liability even when it happens to resolve. A theme block references other theme-block variables,
or repeats the literal. Everything below follows both halves.

### 4.2 `styles.css`

```css
@import "tailwindcss";
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";

@custom-variant dark (&:is([data-theme="dark"] *));

@theme inline {
  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, SFMono-Regular, monospace;
  --font-display: var(--display-font);

  /* one label step below text-xs, and the kicker tracking */
  --text-2xs: 0.6875rem;
  --text-2xs--line-height: 1rem;
  --tracking-label: 0.14em;

  /* integer radii instead of fractions of --radius */
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: calc(var(--radius) - 1px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --shadow-xs: var(--elev-xs);
  --shadow-sm: var(--elev-sm);
  --shadow-md: var(--elev-md);
  --shadow-lg: var(--elev-lg);
  --shadow-card: var(--card-shadow);

  --container-page: 80rem;

  /* …the existing 18 role mappings, unchanged… */
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
}

:root,
[data-theme="light"] {
  color-scheme: light;
  --background: #faf9f6;
  --foreground: #1a1d1b;
  --card: #ffffff;
  --card-foreground: #1a1d1b;
  --popover: #ffffff;
  --popover-foreground: #1a1d1b;
  --secondary: #edeee9;
  --secondary-foreground: #2a2e2b;
  --muted: #f1f0eb;
  --muted-foreground: #6b7069;
  /* accent is a tint, not a second brand colour */
  --accent: #e7efe9;
  --accent-foreground: #24483a;
  --primary: #2f5d46;
  --primary-foreground: #ffffff;
  --destructive: #b3261e;
  --success: #2f6b4f;
  --success-foreground: #ffffff;
  --warning: #8a5a12;
  --warning-foreground: #ffffff;
  --border: #e4e2da;
  --input: #cfcdc3;
  --ring: #3e7a5c;
  --chart-1: #2f5d46;
  --chart-2: #4f8a8b;
  --chart-3: #c08a3e;
  --chart-4: #b4574e;
  --chart-5: #5b6b8c;
  --radius: 6px;
  /* literals on purpose: see 4.1 */
  --display-font: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --elev-xs: 0 1px 2px rgb(24 32 27 / 0.05);
  --elev-sm: 0 1px 3px rgb(24 32 27 / 0.06), 0 1px 2px -1px rgb(24 32 27 / 0.06);
  --elev-md: 0 4px 8px -2px rgb(24 32 27 / 0.06), 0 2px 4px -2px rgb(24 32 27 / 0.05);
  --elev-lg: 0 12px 24px -6px rgb(24 32 27 / 0.08), 0 4px 8px -4px rgb(24 32 27 / 0.05);
  --card-shadow: var(--elev-xs), inset 0 1px 0 rgb(255 255 255 / 0.8);
  --shimmer-highlight: rgb(255 255 255 / 0.45);
  --ease-emphasized: cubic-bezier(0.2, 0.7, 0.2, 1);
}

[data-theme="dark"] {
  color-scheme: dark;
  --background: #121513;
  --foreground: #eceee9;
  --card: #191d1a;
  --card-foreground: #eceee9;
  --popover: #191d1a;
  --popover-foreground: #eceee9;
  --secondary: #232925;
  --secondary-foreground: #eceee9;
  --muted: #212622;
  --muted-foreground: #a2a8a1;
  --accent: #1e3a2c;
  --accent-foreground: #c9e4d2;
  --primary: #9cc7ab;
  --primary-foreground: #10231a;
  --destructive: #f2b8b5;
  --success: #8fbf9f;
  --success-foreground: #10231a;
  --warning: #e0b36a;
  --warning-foreground: #10231a;
  --border: #2c332e;
  --input: #3a423c;
  --ring: #7fb894;
  --chart-1: #8fbf9f;
  --chart-2: #7fb3b4;
  --chart-3: #e0b36a;
  --chart-4: #e08a80;
  --chart-5: #93a3c4;
  --radius: 6px;
  --card-shadow: var(--elev-xs), inset 0 1px 0 rgb(255 255 255 / 0.04);
  --shimmer-highlight: rgb(255 255 255 / 0.07);
  --ease-emphasized: cubic-bezier(0.2, 0.7, 0.2, 1);
}
```

The editorial preset keeps the same block structure and changes only values (`--background`,
`--radius: 12px`, `--display-font`, the serif).

### 4.3 What each addition buys

| Token | Buys |
|---|---|
| `--elev-* → shadow-*` | an elevation vocabulary both the prompt and hand-written CSS can name |
| `--shadow-card` | the inset highlight that separates card from canvas |
| `--text-2xs`, `--tracking-label` | the kicker/label step |
| `--font-mono` | comparable figures (`tabular-nums`) |
| `--radius-sm/md/lg/xl` | integer radii, one shape language |
| `--container-page` | replaces the template's `max-w-[80rem]` |
| `--success/warning` | removes the reason to write `bg-green-100` |
| `--chart-1..5` | charts without palette classes |
| `--display-font` | the second preset, no component fork |

## 5. Type

| Role | Utility | Notes |
|---|---|---|
| Page title | `text-2xl font-semibold tracking-tight` | `Page` owns it |
| Section | `text-lg font-medium` | card groups, list headers |
| Body / UI | `text-sm` | the default for everything interactive |
| Meta | `text-xs text-muted-foreground` | timestamps, counts, hints |
| Kicker | `text-2xs font-medium tracking-label uppercase text-muted-foreground` | preceded by a 16px rule |
| Figure | `font-mono tabular-nums` | stats, table cells, money |

Never below `text-xs` for content (labels are the exception); no arbitrary sizes; headings use
`font-display` only in `Page`'s `h1`, `CardTitle` and marketing sections.

## 6. Shape and elevation

| Surface | Classes |
|---|---|
| Control (button, input, select) | `rounded-lg h-9 px-3 text-sm shadow-xs` |
| Card | `rounded-lg border border-border bg-card p-5 shadow-card` |
| Card header / footer | `pb-3` / `pt-3 border-t border-border` |
| Dropdown, select content | `rounded-lg shadow-md` |
| Dialog | `rounded-xl shadow-lg` |

## 7. Colour

- `--primary` is the one action colour; `--accent` is a tint surface; `--ring` is focus.
- Status (`success`, `warning`, `destructive`) lives in badges, dots and short messages, never
  as a row fill.
- Contrast floors: body text ≥ 4.5:1, `--primary` on `--background` (7.3:1 light), white on
  `--accent` was the old defect (3.3:1) and is now ≥ 7:1 on the tint background with
  `--accent-foreground`; focus ring ≥ 3:1 against both the control and the page.
- `--input` is darker than `--border`: an input border is a control boundary, a card border is not.

## 8. Motion

Zero dependencies: no `motion`, Lottie, Rive or GSAP — a patch cannot add a dependency, and a
preinstalled library would cost every WebContainer install. Six recipes, all `transform`/`opacity`
only, all `prefers-reduced-motion` safe:

```css
@keyframes facilis-fade-up { from { opacity: 0; transform: translateY(8px); } }
@keyframes facilis-pop-in { from { opacity: 0; scale: 0.97; } }
@keyframes facilis-shimmer { to { transform: translateX(100%); } }
@keyframes facilis-draw { to { stroke-dashoffset: 0; } }

@layer utilities {
  .enter { animation: facilis-fade-up 400ms var(--ease-emphasized) both; }
  .enter-stagger > * {
    animation: facilis-fade-up 400ms var(--ease-emphasized) both;
    /* the cap is in the CSS: a 30-row list cannot animate for 1.5s */
    animation-delay: calc(min(var(--i, 0), 7) * 50ms);
  }
  .lift {
    transition:
      translate 200ms var(--ease-emphasized),
      box-shadow 200ms var(--ease-emphasized);
  }
  /* pathLength="1" on the path; no getTotalLength() in JS */
  .draw {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: facilis-draw 700ms var(--ease-emphasized) forwards;
  }
  .shimmer { position: relative; overflow: hidden; }
  .shimmer::after {
    content: "";
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, var(--shimmer-highlight), transparent);
    animation: facilis-shimmer 1600ms linear infinite;
  }
}

@media (hover: hover) {
  .lift:hover { translate: 0 -2px; box-shadow: var(--elev-md); }
}

@media (prefers-reduced-motion: reduce) {
  .enter,
  .enter-stagger > *,
  .shimmer::after { animation: none; }
  .shimmer::after { display: none; }
  .lift { transition: none; }
  .lift:hover { translate: none; box-shadow: var(--card-shadow); }
  .draw { animation: none; stroke-dashoffset: 0; }
}
```

Rules: one entrance per page; `ambient` (a blurred gradient that rotates over 20–30s) only on a
hero, never behind a data view; `pop-in` for Base UI popups (the existing 120ms keyframe stays
until `tw-animate-css` is considered); never animate layout properties, never `transition: all`,
never `will-change` blanket. SVG is allowed for empty-state art, line-draw icons and charts
(`PATTERNS.md` already specifies SVG bars). View Transitions are deferred.

## 9. Page anatomy

| Surface | Shape |
|---|---|
| Shell | sidebar 248px / topbar 56px, then `mx-auto w-full max-w-page px-6 py-6` |
| App page | `<Page>` header (title, description, actions right) + `flex flex-col gap-6` |
| Stat row | `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`; label kicker + `font-mono text-3xl tabular-nums` + delta badge |
| List | toolbar (search, filter, one primary), table inside a card, footer count |
| Detail | title + meta line, two columns (main / aside), related rows as a compact table |
| Form | `max-w-xl`, `gap-4` fields, actions right-aligned, inline errors |
| Auth | centred card `max-w-sm` |
| Empty | `min-h-80` centred, 40px muted icon tile, title, one line, one action |
| Loading | skeleton rows that mirror the real layout — never a bare spinner |
| Error | `Alert` with the code mapped through `errorMessageKey`, plus retry |

## 10. The AI contract

**Design block** — twelve bullets shipped in the system prompt, after `## Rules` and before
`## Canonical shapes`, inside the stable prefix so the provider cache still hits. It lives in
`ide/src/ai/prompt-design.ts` as `DESIGN_PROMPT` (≤ 450 tokens) and is included whenever the
write tools are available:

```text
## Design (how a page looks)
1. Colour, radius and shadow come from role tokens only: bg-background, text-muted-foreground,
   border-border, bg-card, bg-primary, shadow-card. Never raw hex, never palette classes
   (bg-blue-600, bg-slate-100), never arbitrary values (p-[13px], text-[15px]). A colour the
   project lacks is a variable added to both theme blocks in src/styles.css.
2. Type: page title text-2xl font-semibold tracking-tight; section text-lg font-medium; body
   text-sm; meta text-xs text-muted-foreground; labels text-2xs font-medium tracking-label
   uppercase. Numbers use font-mono tabular-nums.
3. Every route renders inside <Page title description actions>; sections are flex flex-col gap-6.
   Never hand-roll page padding, a header or a container.
4. One primary action per view, in Page actions; every other action is outline or ghost. Lists
   and tables are the default surface; a form lives on a page, not in a modal.
5. Cards: rounded-lg border border-border bg-card p-5 shadow-card; header pb-3, footer pt-3
   border-t; one idea per card, at most three per row at lg.
6. Every async surface ships four states in the same patch: Skeleton rows that mirror the real
   layout, EmptyState (icon, one line, one action), Alert + retry, ready. A spinner-only screen
   is not a loading state.
7. Forms: Field + Label + inline error; submit disabled with Spinner while pending; focus the
   first invalid field; toast on success.
8. Tables: h-11 rows, sticky header, right-aligned numbers with tabular-nums, one line per cell.
9. Motion: the CSS recipes enter, enter-stagger, lift, draw, shimmer, pop-in. 150-400ms,
   transform and opacity only, one entrance per page, honour motion-reduce. Never add a motion
   library; never animate layout properties.
10. Copy: sentence case, no exclamation marks, no filler ("seamless", "powerful",
    "effortlessly"); title <= 5 words, description <= 90 characters, button 1-3 words; every
    string through t().
11. Responsive: one column on mobile, sm:/md: for columns, no fixed widths, no horizontal
    scroll on content, 40px minimum tap target.
12. Done: keyboard reachable, visible focus ring, contrast >= 4.5:1, dark mode checked,
    empty/loading/error present. A page that only looks right in light mode is not done.
```

**Three supporting layers**, because prose alone is the weakest lever:

1. `DESIGN.md` in the generated project (the token list and five conventions), injected like
   `AGENTS.md` with a 2k-character cap — project taste the user can edit.
2. A **reference section** in the template: one list → detail → chart slice built to
   `PATTERNS.md`, and a prompt line telling the model to read `src/components/ui/page.tsx` and
   that page before inventing a shell. Examples beat rules, and cost tokens only when read.
3. **Non-blocking warnings** on the returned patch (raw hex, palette class, arbitrary value,
   missing `<Page>`, missing states), reported as a rate. Never a validator error: a new error
   rule buys repair loops, not quality.

Rule 5 of `SPEC §9.2` loses its dead "use the existing blocks" reference and names components
and layouts instead (the block package was retired, D-131).

## 11. Verification and rollout

- **P0** — tokens + motion layer in `examples/todo-app/src/styles.css`, `card`/`button`/
  `page`/`empty-state`/`skeleton` touch-ups, `app-layout` and `not-found` use `max-w-page`.
  Screenshot A/B on login, register, 404 and the todos list, light and dark.
- **P1** — `DESIGN_PROMPT`, the `DESIGN.md` injection, the rule-5 fix, SPEC §9.2 update.
- **P2** — reference section + `PATTERNS.md` accepted (not draft) + the warning linter.
- **P3** — eval suite: fixed prompts (dashboard, list + create, settings form, auth, empty,
  error) × 3 seeds, `preview_screenshot` + a rubric judge; metrics are output tokens, turns to
  first correct render, warning rate and repair rate.

Acceptance: contrast floors met (§7), reduced motion honoured, both themes complete, primitives'
APIs unchanged, no new validator error rule, and hand-built pages still match the template's look.

**Existing projects do not update.** The template is copied at creation; a project created
before P0 keeps the old look. Migration is opt-in — asking the AI to apply the token block — and
is out of scope here.
