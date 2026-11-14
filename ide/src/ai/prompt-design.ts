// The design section of the system prompt (docs/DESIGN.md §10, D-185).
//
// Twelve terse bullets: the token vocabulary the template ships, page anatomy, the four
// states and the quality bar. It lives in its own module because prompt.ts sits at the
// file-length limit and because this text is a reviewed contract, not incidental copy.

export const DESIGN_PROMPT = [
  "## Design (how a page looks)",
  "1. Colour, radius and shadow come from role tokens only: bg-background, text-muted-foreground, border-border, bg-card, bg-primary, shadow-card. Never raw hex, never palette classes (bg-blue-600, bg-slate-100), never arbitrary values (p-[13px], text-[15px]). A colour the project lacks is a variable added to both theme blocks in src/styles.css.",
  "2. Type: page title text-2xl font-semibold tracking-tight; section text-lg font-medium; body text-sm; meta text-xs text-muted-foreground; labels text-2xs font-medium tracking-label uppercase. Numbers use font-mono tabular-nums.",
  "3. Every route renders inside <Page title description actions>; sections are flex flex-col gap-6. Never hand-roll page padding, a header or a container. Read src/components/ui/page.tsx and src/pages/todos.tsx before inventing a shell.",
  "4. One primary action per view, in Page actions; every other action is outline or ghost. Lists and tables are the default surface; a form lives on a page, not in a modal.",
  "5. Cards: rounded-lg border border-border bg-card p-5 shadow-card; header pb-3, footer pt-3 border-t; one idea per card, at most three per row at lg.",
  "6. Every async surface ships four states in the same patch: Skeleton rows that mirror the real layout, EmptyState (icon, one line, one action), Alert + retry, ready. A spinner-only screen is not a loading state.",
  "7. Forms: Field + Label + inline error; submit disabled with Spinner while pending; focus the first invalid field; toast on success.",
  "8. Tables: h-11 rows, sticky header, right-aligned numbers with tabular-nums, one line per cell.",
  "9. Motion: the CSS recipes enter, enter-stagger, lift, draw, shimmer, pop-in. 150-400ms, transform and opacity only, one entrance per page, honour motion-reduce. Never add a motion library; never animate layout properties.",
  '10. Copy: sentence case, no exclamation marks, no filler ("seamless", "powerful", "effortlessly"); title <= 5 words, description <= 90 characters, button 1-3 words; every string through t().',
  "11. Responsive: one column on mobile, sm:/md: for columns, no fixed widths, no horizontal scroll on content, 40px minimum tap target.",
  "12. Done: keyboard reachable, visible focus ring, contrast >= 4.5:1, dark mode checked, empty/loading/error present. A page that only looks right in light mode is not done.",
].join("\n");
