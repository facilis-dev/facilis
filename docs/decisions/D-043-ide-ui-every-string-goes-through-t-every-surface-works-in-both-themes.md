# D-043 — IDE UI: every string goes through `t()`, every surface works in both themes
**Status:** accepted (2026-10-31)

The Studio is a product surface, not a demo: its chrome has to be translatable and readable
in either theme from the first panel we ship. Both rules therefore apply to **everything this
project adds or touches**, and the upstream-inherited chrome is retrofitted file by file (the
checklist lives in `ide/I18N.md`).

**Strings.** Every user-facing string in `ide/` goes through `t()` from `ide/src/i18n`, with
its text in `ide/src/i18n/en.ts` and (where translated) `ide/src/i18n/it.ts`. The runtime is the
framework's own i18n (`@facilis.dev/core/i18n`: flat keys per O-001, `{placeholder}` interpolation, a
missing key returns the key and is reported once) — the IDE imports that **subpath** so the
static SPA bundle does not pull the framework's zod/db modules. `it` may be partial: at boot
`registerCatalog("it", { ...en, ...it })` makes a missing translation fall back to English key
by key. The locale is the saved choice, else the browser language, else English; the catalogues
are registered and the locale applied by `initI18n()` before the first render, and
`document.documentElement.lang` follows.

**Themes.** next-themes drives the `.dark` class (`attribute="class"`); every surface uses the
semantic tokens (`bg-background`, `bg-sidebar`, `bg-card`, `bg-accent`, `text-foreground`,
`text-muted-foreground`, `border-border`, …) so one class flips the window. Raw palette colours
are reserved for brand marks (SVG logos, the VS Code-blue status bar) and scrims, each with a
comment. The theme is user-selectable from the command palette (Light / Dark / System); Monaco and
xterm are not CSS-themed, so `applyUiTheme()` mirrors the resolved theme into them.

**Verification.** `ide/src/i18n/i18n.test.ts` enforces catalogue parity (no unknown key, no empty
value, every `{placeholder}` preserved in translation) and the locale detection/interpolation
behaviour; the smoke suite continues to run the real UI in a browser.

**Consequences:** a new panel cannot merge with a hardcoded label or a light-only surface; adding
a language is a catalogue file plus one entry in `LOCALES`; and the retrofit is a visible,
incremental checklist instead of an open-ended debt.
