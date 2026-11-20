# D-186 — The AI builds screens from a named pattern catalog, and asks when the layout is open
**Status:** accepted (2026-11-14)

**Context.** In an owner trial the request "create a calendar view of the to-dos" came back slow,
with no question asked, the calendar embedded in the existing list page and, on mobile, the list
page turned into an agenda list. Each decision is defensible in isolation; together they are a
convention the owner never chose. The four things the assistant decided silently — where a view
lives, what a filter looks like, how a create flow opens, whether mobile keeps the list — are the
same four on every generated app, so they belong in a catalog, not in a per-turn guess. The
validator cannot help: it proves a patch is safe, not that a screen is placed where the app puts
screens. The structural prompt rules (SPEC §9.2) were also silent on layout and on asking.

**Decision.** The interaction defaults become a contract in [UI-PATTERNS.md](./UI-PATTERNS.md),
applied by default and named in `notes`: create = page-header button → dialog → save; alternate
views (calendar, board, timeline) = their own route with a List | Calendar switcher, the list page
never becomes another view on mobile; list refinements = side drawer (full-screen on mobile) with
chips and URL state, search stays in the toolbar; destructive actions = a confirmation dialog
naming the record; one responsive breakpoint and the four page states on every screen. The
defaults are not law: an explicit user sentence overrides any of them. When the request leaves the
information architecture open — new page versus section of an existing page, which existing view
it replaces, the scope of a destructive change — the assistant asks one short question with the
default it would apply and the alternative, and writes nothing that turn. For a UI change it reads
only `app.tsx`, the target page, the route it calls, the primitives and the locale file. A pattern
that needs a missing primitive (a side sheet, a month grid) may add that one file under
`src/components/ui`, which is the pattern's requirement rather than an invented block (rule 5).

**Consequences.** The catalog is enforced by prompt and review, not by the 19-rule validator, and
that is deliberate: screen placement is a design decision a human reviews. Adding a pattern is now
a decision entry, not a prompt tweak — the list is closed so it stays copyable. SPEC §9.2 gains
rule 17 so the defaults are part of the AI contract, and the existing section standard in
[PATTERNS.md](./PATTERNS.md) (list → detail → chart) remains its data/API half; this file is the
interaction half. The Ask-before-you-guess rule costs one turn on ambiguous requests and saves the
rebuild that the trial produced.

**Reconciliation with D-185 (design, merged the same day).** The visual contract keeps the look —
tokens, type, cards, motion, four states — and the interaction catalog owns placement inside it.
D-185's `DESIGN_PROMPT` rule 4 and `docs/DESIGN.md` §10 said "a form lives on a page, not in a
modal"; that blanket sentence was written before the owner asked for the create-dialog pattern, and
it now reads: a short, single-step create form (five fields or fewer) opens in a Dialog from the
page header, while a long, multi-step or deep-linkable form keeps its own page. The two rules meet
at the form's size, not at a preference; a project's `DESIGN.md` still narrows the look only.
