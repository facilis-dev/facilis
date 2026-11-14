# UI interaction patterns — the defaults the AI builds from

Status: accepted (2026-11-14, D-185). This is the **interaction** half of the pattern
contract; the **data** half is [PATTERNS.md](./PATTERNS.md) (list → detail → chart, one
envelope, one route shape). Read them together: PATTERNS.md says what a section is, this file
says where its screens live and how they behave.

The catalog exists because the defaults were being invented per turn. An owner trial asked for
"a calendar view of the to-dos" and got an embedded calendar that, on mobile, replaced the todo
list — three defensible decisions that were not the app's convention, taken without a question.
The decisions below are the same on every generated app, so they are named, finite and
copyable. The model applies them without asking, says which one it used in `notes`, and the
user overrides any of them in one sentence.

## 1. How the catalog is used

1. **Default first.** The AI applies the catalog; it does not ask permission to apply it.
2. **The user wins.** "Put the calendar inside the todos page" is a complete override; the AI
   follows it and says so in `notes`. A pattern is never re-argued in a later turn.
3. **Ask when the layout is open.** If the request does not settle the information architecture
   (new page or section? which existing view does it replace? what does a destructive change
   touch?), the AI asks **one** question, states the default it would apply and the alternative,
   and writes nothing that turn. Style, naming and file placement are decided, never asked.
4. **Placement and flow, not looks.** Spacing, tokens and component anatomy are
   [FRONTEND.md](./FRONTEND.md)'s; this catalog only says which screen, which overlay, which
   state.
5. **The list is closed.** A new pattern is a decision entry ([DECISIONS.md](./DECISIONS.md)),
   not a prompt tweak — a catalog that grows by improvisation stops being copyable.

## 2. The catalog

| id | pattern | default | mobile (one `md` breakpoint) | anti-pattern |
|---|---|---|---|---|
| P-01 | create | page-header **New X** → dialog → save | full-screen dialog | inline create card above the table |
| P-02 | alternate view | own route + **List / Calendar** switcher | agenda *inside the calendar route* | calendar embedded in the list page; list page replaced on mobile |
| P-03 | list filters | toolbar search + **Filters** drawer | full-screen sheet | client-side filtering; filters not in the URL |
| P-04 | destructive | confirmation dialog naming the record | same | delete with no confirmation, or a generic "Are you sure?" |
| P-05 | detail | own route, read-only, edit reuses P-01 | same | a detail drawer that cannot be linked |

## 3. P-01 — Create: header button → dialog → save

**Flow.** The page header (the `actions` prop of `Page`) carries one primary `Button` labelled
"New <X>". It opens the `Dialog` from `src/components/ui/dialog.tsx` with the form; **Save**
submits one `POST`, closes the dialog, shows the success toast and refreshes the list in place.

**Rules.**

- One entry point per create flow. No inline create form above the table, no second button in a
  toolbar. Editing reuses the same dialog, pre-filled.
- The dialog owns its form state and disables **Save** while the request runs; the primary button
  is the only `default`-variant button in the footer; **Cancel** is `outline`/`ghost`.
- Validation is inline at the field (`Field` + its error slot); a server `invalid_input` maps
  back to the field. The footer never shows a generic error blob.
- `Escape` and the close button cancel; a clicked backdrop cancels only when the form is clean.
- After save, the list shows the new row without a full page reload (refetch or insert); the toast
  says what was created, not "Success".
- Full-screen on mobile: the dialog fills the viewport below `md`, the form scrolls, the footer
  stays reachable.

**When to deviate.** More than ~6 fields, a multi-step flow (import, wizard) or a form that must be
linkable → its own route `/<resources>/new`, still reached from the same header button. The
dialog is the default, not a religion.

**Anti-patterns.** An inline "add" card above the table as the primary creation path (the todo
template shipped one until it adopted P-01); a dialog that navigates away on save (the list never
refreshes); a create button that opens a detail page in edit mode when the form is one dialog.

## 4. P-02 — Alternate view: its own route

**Shape.** A second route for the same resource — `src/pages/<resource>-calendar.tsx`, declared
in `src/app.tsx` before the detail route when the path nests (`/<resources>/calendar` vs
`/<resources>/:id`). The page keeps a **List | Calendar** switcher in its header (two `Link`s
with `aria-current`, token-only styling; there is no Tabs primitive) so the two views are peers,
and the nav link keeps pointing at the list.

**Data.** The calendar asks for its visible range — `GET /api/<resources>?from=YYYY-MM-DD&to=YYYY-MM-DD`
(or an equivalent stats route) — never "fetch everything and group it". If the resource list is
already unpaginated and small, grouping in memory is allowed and says so in a comment.

**Calendar rules.** Build the month grid with `Date` UTC parts and the
`@facilis.dev/time` helpers (`dateOnlyOf`, `today`, `formatDateOnly`); no date library and no
dependency (same stance as the SVG chart in PATTERNS.md §4.4). Day cells: the date number, up to
three items, then "+N more" opening the day's list. Clicking a day opens P-01 with the due date
pre-filled. A month/week/agenda switch is allowed inside the route, as one control, not as new
routes. Empty months still render the grid and a translated "nothing scheduled" line.

**Mobile.** The calendar route may render its own agenda list for the same range — that is a
*view of the calendar*, with the switcher still present. The existing list page keeps its list at
every width: never `hidden md:block` the list into a calendar, and never "make the list the
agenda on mobile".

**Anti-patterns.** A calendar card under the table ("here is the calendar, at the bottom"); a
calendar that filters the list page in place; a client-side page of a paginated server list;
`fullcalendar`/date-picker dependencies.

## 5. P-03 — List filters: toolbar search, side drawer for refinements

**Toolbar.** Search stays visible: an `Input` (debounced ~250 ms) plus a **Filters** button with
the count of active refinements (`Filters (2)`). The button opens the drawer.

**Drawer.** On `md` and up, a right-hand panel (~360 px) over the page: a `Sheet` built on the
existing `Dialog` primitive (`fixed inset-y-0 right-0`, backdrop, focus trap, `Escape`).
Below `md` it is full-screen. The
footer carries **Apply** and **Clear all**. Filters are grouped by kind (status, dates, tags) and
apply on **Apply** — live filtering is for one toggle, not for date ranges.

**State.** The drawer writes the URL query (`?status=open&due=week`) and the list reads it: a
filtered view is linkable, `Back` works, a reload keeps the filters. Active filters render as
removable chips under the toolbar with a **Clear all**, and the count is derived from them.

**Rules.**

- Filtering and paging are server-side (PATTERNS.md §2.1); the client never loads the table to
  filter it.
- A filtered-empty list says "No results for these filters" + **Clear filters**; the first-run
  empty state with the create action is a different state.
- Search and at most **two** high-frequency refinements may stay in the toolbar (a status
  `Select`); from three up — or when a value list needs scrolling — everything moves to the
  drawer ([Carbon filtering](https://www.carbondesignsystem.com/building-blocks/core/patterns/filtering/)).
- Closing the drawer without Apply leaves the current filter state untouched.

**Anti-patterns.** A filter bar that grows four selects wide; a drawer that closes on Apply but
loses the filters on reload; chips that are decoration (not removable); a search that queries the
loaded rows.

## 6. P-04 — Destructive actions

- A row that is cheap to recreate and truly reversible may delete on one click **with an Undo
  toast** instead of a dialog; everything else gets the confirmation.
- The confirmation is a `Dialog` that **names the record** ("Delete todo 'Buy milk'?"), with the
  destructive verb on the button ("Delete", never "OK"), `outline` cancel focused first, and the
  irreversible consequence in one line.
- After success: a toast, the row gone, the list refreshed; no fake undo if there is no undo.
- Bulk actions state the count ("Delete 3 todos?") and never hide the scope behind "selected
  items".
- Say **Delete** for a resource and **Remove** for detaching a row from a list or form.
- A schema-destroying change is a separate gate (SPEC §9.2 rule 15), not this dialog.

**Anti-patterns.** "Are you sure?" with no record name; delete on a single click from a row menu;
using the destructive variant for a reversible archive.

## 7. P-05 — Detail

- Its own route `src/pages/<resource>-detail.tsx` (`/<resources>/:id`), reached from the row
  title/link and from a calendar item.
- A back link to the list, the record read-only (definition list or card), linked rows last
  (PATTERNS.md §2.2), and **Edit** opening P-01 pre-filled.
- `not_found` renders the `EmptyState` with a back action, never an error blob.

**Anti-patterns.** A detail drawer with no URL; a detail page that is an edit form on arrival.

## 8. Cross-cutting: one breakpoint, four states

- **One breakpoint, `md`.** Tables become stacked cards, drawers and dialogs become full screen,
  filter bars collapse. Layout changes; the screen's concept does not.
- **Four states per screen:** skeleton while loading, `EmptyState` with the primary action, an
  inline error with retry, and the keys for all of them in `locales/en.json` — every string
  through `t()` (SPEC §9.2 rule 6).
- Touch targets ≥ 44 px, no horizontal scroll at 360 px.
- Toast for a mutation's outcome; inline for a list's load error (PATTERNS.md §4.2).

## 9. Ask-first matrix

| the request leaves open | the one question | default the AI proposes |
|---|---|---|
| where new UI lives | "New page or a section of <existing page>?" | own route |
| whether an existing view changes | "Should <view> keep its current layout? (default: yes)" | keep |
| scope of a destructive change | "This deletes <what>: confirm the scope?" | the named record only |
| a filter's reach | "Global filter or per view?" | the view that opened it |

One question, one turn, no patches. Anything else — style, naming, file placement, component
choice — is decided by the AI.

## 10. How to change the catalog

- Propose the pattern with the screens it changes and the anti-pattern it replaces; add an entry
  here and a decision in DECISIONS.md in the same change.
- Keep the prompt section (`ide/src/ai/prompt-patterns.ts`) in step with this file: the model
  never reads the docs, only the prompt.
- A pattern that needs a primitive the template lacks (a side sheet, a month grid) ships that one
  file under `src/components/ui` as part of the pattern, token-only and dependency-free.

## 11. Sources

The rules above are the conventional practice; these are the references they were checked
against (2026-11-14):

- **Create in a modal vs a page** — [Carbon modal usage](https://www.carbondesignsystem.com/building-blocks/core/components/modal/usage/),
  [Apple sheets](https://developer.apple.com/design/human-interface-guidelines/sheets),
  [Cloudscape create](https://cloudscape.design/patterns/resource-management/create/).
- **Dialog behaviour and focus** — [WAI-ARIA APG dialog (modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- **Validation and errors** — [GOV.UK validation](https://design-system.service.gov.uk/patterns/validation/),
  [GOV.UK error summary](https://design-system.service.gov.uk/components/error-summary/),
  [WCAG 3.3.1](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html).
- **Filters: toolbar vs drawer, chips, apply vs live** — [Carbon filtering](https://www.carbondesignsystem.com/building-blocks/core/patterns/filtering/),
  [Cloudscape filter patterns](https://cloudscape.design/patterns/general/filter-patterns/).
- **Filters in the URL** — [Cloudscape: filter persistence in collection views](https://cloudscape.design/patterns/general/filter-patterns/filter-persistence-in-collection-views/).
- **Empty vs zero-results vs error** — [Cloudscape empty states](https://cloudscape.design/patterns/general/empty-states/),
  [Cloudscape user feedback](https://cloudscape.design/patterns/general/user-feedback/),
  [GOV.UK problem with the service](https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/).
- **Loading** — [NN/g: skeleton screens](https://www.nngroup.com/articles/skeleton-screens/).
- **Calendar as a peer view, +N more, create from a day** — [FullCalendar list view](https://fullcalendar.io/docs/list-view),
  [dayMaxEvents](https://fullcalendar.io/docs/dayMaxEvents), [dateClick](https://fullcalendar.io/docs/dateClick),
  [Apple segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls).
- **Destructive actions: confirm vs undo, wording** — [NN/g: confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/),
  [Cloudscape: one-click delete](https://cloudscape.design/patterns/resource-management/delete/one-click-delete/),
  [Cloudscape: delete with simple confirmation](https://cloudscape.design/patterns/resource-management/delete/delete-with-simple-confirmation/),
  [Cloudscape: delete with additional confirmation](https://cloudscape.design/patterns/resource-management/delete/delete-with-additional-confirmation/).
- **Modal tasks that grow complex; one sheet at a time** — [Apple modality](https://developer.apple.com/design/human-interface-guidelines/modality).
