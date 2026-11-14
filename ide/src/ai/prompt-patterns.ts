// The UI pattern defaults for a generated app (D-186, docs/UI-PATTERNS.md).
//
// A prompt section rather than a validator rule: the shape of a screen is a design decision a
// human reviews, not something a static checker can prove. Short on purpose — these are the
// five decisions the model kept getting wrong — and every entry names something the template
// ships, so the model has nothing to invent.

export const PATTERNS_PROMPT = [
  "## UI patterns (defaults, not law)",
  "The app's screens follow these defaults (the catalog is documented for humans in docs/UI-PATTERNS.md). Apply them without asking, name the pattern you applied in \"notes\", and let the user's explicit choice override any of them.",
  '- Create: a "New <X>" button in the page header (the Page actions prop) opens a Dialog with the form; Save closes it, toasts and refreshes the list in place. No inline create form above the table, and no second entry point. Validation is inline, the dialog is full screen on small screens, and editing reuses it pre-filled.',
  "- Alternate views (calendar, board, timeline): their own route (src/pages/<resource>-calendar.tsx, added to app.tsx), with a List | Calendar switcher in the page header. Never embed a second view in the existing list page, and never turn the list page into the calendar on mobile: the calendar route may render an agenda list on small screens, the list page keeps its list.",
  '- List filters: search and at most two high-frequency refinements stay in the page toolbar; the rest (status, dates, tags) live in a side drawer on desktop and a full-screen sheet on mobile, opened by a "Filters" button that shows the active count. Active filters render as removable chips, and the URL query carries them so a filtered list can be linked.',
  '- Destructive actions: a confirmation Dialog that names the record and a button labelled with the destructive verb ("Delete"), or an Undo toast for a truly reversible row; never a silent delete-all.',
  "- Detail: its own route (src/pages/<resource>-detail.tsx) with a back link; the record renders read-only, and editing reuses the create dialog.",
  "- Responsive, one breakpoint (md): tables become stacked cards, the drawer and the dialog become full screen. The layout changes; the screen does not.",
  "- Every screen ships its four states: a skeleton while loading, an EmptyState with the primary action, an inline error with retry, and the keys for all of them in locales/en.json (rule 6).",
  '- A pattern may need a primitive the project does not ship (a side sheet, a month grid): create that one file in src/components/ui as part of the same change, name it in "notes", keep it token-only and dependency-free. That is the pattern\'s requirement, not an invented block (rule 5).',
  "## Ask before you guess",
  'Ask one short question instead of writing when the request leaves the information architecture open: whether new UI is a new page or a section of an existing one, which existing view it replaces, whether a filter is global or per view, or whether a destructive change spans more than the named record. Answer with a normal AIResponse whose "patches" is empty: state the default you would apply and the alternative in one sentence (for example: "Calendar as its own route linked from Todos, or embedded in the Todos page? Default: own route."). Decide style, naming and file placement yourself; never ask about those.',
  "## Do not explore a UI change",
  "For a UI request read only src/app.tsx, the target page, the route it calls when the data shape is missing, the ui primitives and locales/en.json you will touch; then write. Do not read the schema or the server when the change is a screen over existing data.",
].join("\n");
