# D-128 — The guided tour is a first-run overlay over the real IDE
**Status:** accepted (2026-11-09)

Classic IDEs and editors teach their layout with a short guided tour. Facilis has many
surfaces (graph, Explorer, chat, preview, bottom panel, status bar, command palette) and no
in-product explanation of them; a screenshot tour would go stale on the first UI change.

**Decision.** A small, custom, in-app tour: `ide/src/tour/` holds the step list, the state
machine and the card/spotlight geometry (pure, unit-tested); `components/tour/` renders an
overlay that, for each step, **runs an action** (opens the Explorer, the chat, the preview,
the bottom panel) and then spotlights the real element — located by a `data-tour` attribute
— with an animated scrim and a card. Eight steps, the chat step omitted when the deployment
disables AI. It auto-starts once per origin after the first workspace open (`vv.ide-tour`,
versioned), is replayable from the `?` button in the title bar and from the command palette,
skips on `Esc`, ends if the user leaves the workspace, and respects
`prefers-reduced-motion`. Automated/headless runs never auto-start it (`navigator.webdriver`
or a `HeadlessChrome` user agent, plus an explicit `?tour=off`): the smoke suite must drive
the real UI, not an overlay.

**Why custom instead of a library.** The anchors are our own attributes, the positioning is
`getBoundingClientRect` + a few pure functions, the look must use the semantic theme roles
(D-043/D-044), and the tour is small enough that a dependency (driver.js, react-joyride,
shepherd) would add packaging, styling and accessibility decisions we would only fight. The
parts that can break are pure and covered by Vitest.

**Rejected alternatives.** *A static welcome modal*: it explains nothing about the actual
UI. *A library*: see above. *Auto-start on every project open*: noisy; once per origin, then
opt-in. *Starting it on the Home screen*: there is no workspace chrome to explain yet.

**Consequences.** One more `data-tour` attribute on the surfaces the tour points at
(activity bar, status bar, panel wrappers, help button); the strings are under `tour.*` in
`ide/src/i18n/en-tour.ts` / `it-tour.ts`; the overlay is `z-50`, above the app but in the
same layer as dialogs, and it owns a real `role="dialog"`.
