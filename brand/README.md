# facilis.dev — brand assets

Black and white only. The mark is a geometric “F” in a full-bleed squircle; the wordmark always
writes **facilis.dev** (the site is the name), with `.dev` in the lighter weight.

## Assets

| File | Use |
| --- | --- |
| `facilis-icon.svg` | App icon, avatar, favicon source. Full-bleed squircle, white F on ink. |
| `facilis-icon-inverse.svg` | Same icon on a white squircle, for dark surfaces. |
| `facilis-mark.svg` | The F alone (single ink, no tile). |
| `facilis-mark-inverse.svg` | The F alone in white, for dark surfaces. |
| `facilis-logo.svg` | Primary horizontal lockup on light backgrounds. |
| `facilis-logo-inverse.svg` | Primary horizontal lockup on dark backgrounds. |
| `facilis-logo-mono.svg` | Single-ink lockup (no tile) for print, engraving, one-colour work. |
| `facilis-logo-stacked.svg` | Centred vertical lockup for splash / social. |
| `facilis-wordmark.svg` | The wordmark alone. |
| `facilis-favicon.svg` | Favicon: black tile in light mode, white tile in dark mode. |
| `facilis-brand-sheet.svg/.png` | One-page overview (1600×1200). |
| `png/` | Raster exports: icon 16→1024, lockups 400/800/1600, OG image, Apple touch icon. |

## Colour

Pure black and white — no tints, gradients or effects.

| Role | Value |
| --- | --- |
| Ink | `#0B0B0C` |
| Paper | `#FFFFFF` |
| Grey (support only, never in the logo) | `#6B7280` |

## Type

The wordmark is **Manrope** — Bold 700 for `facilis`, SemiBold 600 for `.dev`. All glyphs are
outlined in the SVGs (SIL Open Font License), so no font needs to be installed or loaded.

## Usage

- Keep clear space of at least **half the mark's height** on every side.
- Minimum sizes: icon 16 px; horizontal lockup 120 px wide (below that use the icon).
- On dark surfaces use the inverse asset; on images, place the inverse lockup on a dark scrim.
- Never: recolor, outline, rotate, add shadows/gradients, retype the wordmark, or separate the
  `.dev` from `facilis`.

## Where the app uses it

- `ide/public/favicon.svg` — the browser tab (adapts to `prefers-color-scheme`).
- `ide/public/apple-touch-icon.png` — iOS home screen.
- `ide/public/facilis-lockup.svg` — single-ink mask painted with `currentColor` for the Home
  header (`.brand-lockup` in `ide/src/index.css`).
