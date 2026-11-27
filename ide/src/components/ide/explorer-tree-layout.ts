// Row geometry and the reveal helper shared by the Explorer tree and its inline
// rename/create field.

// Row height in px, and the single source of truth for the sticky stack: an
// ancestor row parks at `depth * ROW_H`, under the rows already parked above it,
// so the sum is only right while every row in the stack is exactly this tall. It
// is SET on those rows because the font metrics differ between root and folder rows.
export const ROW_H = 24;
// Parked rows overlap, so z-index decreases with depth (and never reaches 0).
const STICKY_Z = 20;
export const stickyStyle = (depth: number) => ({
  top: depth * ROW_H,
  zIndex: Math.max(1, STICKY_Z - depth),
});

// Vertical clearance required before a row counts as "already in view". Zero would
// re-create the bug this is meant to fix: a row one pixel inside the bottom edge is
// technically visible, so it would be left parked there. One row means a sibling is
// always visible on the row's nearest side, which is what makes its position readable.
const REVEAL_CLEARANCE = ROW_H;

// Scroll a row into view PAST the parked stack, and — for `align: "center"` — near the
// middle rather than wherever is closest.
//
// Two separate things are going on here. First, `scrollIntoView` and `focus()` both
// align their target with the scrollport's top edge, which is exactly where the sticky
// ancestors sit, so left alone they "reveal" a row that is completely behind them.
// `scroll-padding-top` is how you tell the scroll machinery that a band at the top of
// the scrollport is not usable; the stack above a row at `depth` is its own ancestor
// chain, i.e. `depth` rows. Set per-call because the height depends on the target.
// The selector is a real dependency on `ui/scroll-area.tsx`, which says so at that end too.
//
// Second, the alignment. `block: "nearest"` is *minimum* scrolling by definition, so
// revealing a row from below parks it flush against the bottom edge every time — which
// is what "it keeps ending up right at the bottom" was. `"center"` puts it mid-viewport
// (mid-*usable*-band, since scroll-padding shrinks the optimal viewing region), and the
// browser clamps the resulting scroll offset, so a target near either end of the list
// lands as close to the middle as the scroll range permits with no arithmetic here.
//
// Centring unconditionally would lurch the tree on every tab switch, including when the
// row was already sitting in plain sight, so a row with `REVEAL_CLEARANCE` on both sides
// is left exactly where it is.
export const revealRow = (
  el: HTMLElement | null,
  depth: number,
  align: "center" | "nearest" = "center",
) => {
  if (!el) return;
  const viewport = el.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
  const padTop = depth * ROW_H;
  if (viewport) viewport.style.scrollPaddingTop = `${padTop}px`;
  if (align === "center" && viewport) {
    const vp = viewport.getBoundingClientRect();
    const row = el.getBoundingClientRect();
    if (
      row.top >= vp.top + padTop + REVEAL_CLEARANCE &&
      row.bottom <= vp.bottom - REVEAL_CLEARANCE
    ) {
      return;
    }
  }
  el.scrollIntoView({ block: align });
};
