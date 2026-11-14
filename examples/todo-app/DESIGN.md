# Design

How this app looks. This file is what the assistant reads before writing UI (D-185): it refines
the design rules in the system prompt for this project and cannot contradict them.

## Tokens

`src/styles.css` is the single point of truth — roles in `:root` and `[data-theme="dark"]`,
mapped through `@theme inline`. Never write a colour, radius or shadow literal in a component.

| Need                   | Use                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------- |
| page                   | `bg-background text-foreground`                                                     |
| surface                | `bg-card border border-border rounded-lg shadow-card`                               |
| quiet text             | `text-muted-foreground`                                                             |
| action                 | `bg-primary text-primary-foreground`, hover `bg-primary/90`                         |
| tint (hover, selected) | `bg-accent text-accent-foreground`                                                  |
| status                 | `bg-success` / `bg-warning` / `bg-destructive`, badges and dots only                |
| chart                  | `bg-chart-1` … `bg-chart-5`                                                         |
| elevation              | `shadow-xs` control · `shadow-card` card · `shadow-md` overlay · `shadow-lg` dialog |

## Type

Page title `text-2xl font-semibold tracking-tight` (inside `<Page>`) · section `text-lg
font-medium` · body `text-sm` · meta `text-xs text-muted-foreground` · label `text-2xs
font-medium tracking-label uppercase`. Every figure uses `font-mono tabular-nums`.

## Composition

- One `<Page>` per route: title, description, actions on the right.
- Cards: `p-5`, header `pb-3`, footer `pt-3 border-t`. One idea per card.
- A list is a toolbar plus a table inside a card; a form is a page, not a modal.
- Empty, loading, error and ready ship together. `Skeleton` mirrors the real layout and
  `EmptyState` carries the action that fixes it.

## Motion

The CSS recipes in `src/styles.css` are the whole vocabulary: `enter`, `enter-stagger` (set
`--i` per child), `lift` on clickable cards, `draw` on an SVG path with `pathLength="1"`,
`shimmer` on skeletons; Base UI popups animate themselves. One entrance per page, 150–400 ms,
`transform`/`opacity` only, and the recipes already honour `prefers-reduced-motion`.
