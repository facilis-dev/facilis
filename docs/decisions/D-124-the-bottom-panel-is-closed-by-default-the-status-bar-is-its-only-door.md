# D-124 — The bottom panel is closed by default; the status bar is its only door
**Status:** accepted (2026-11-08)

The IDE inherited VS Code's chrome, where the bottom panel (Console / Terminal / Ports) is
opened from a layout toggle in the title bar and every run force-opened it to narrate
`npm install`. That fits a developer's editor and misfits this product's main user, who is
building an app in the browser: the console is kernel narration nobody needs, the terminal is
only how the app gets started, and "ports" are in-VM listeners reached through the preview, not
host ports. The panel was also the only way to start a project (command palette, or the create
dialog's "Install and run" checkbox) and there was no Stop.

**Decision.** The bottom panel starts closed and nothing opens it implicitly — not a run, not
opening a project. Its three surfaces are opened from chips at the right of the status bar
(Console icon-only, Terminal, Ports with a live count); clicking the active chip closes the
panel, and the panel no longer carries its own tab strip. The same status bar row carries
`Run`/`Stop` for the active folder: idle → `Run`; during install → a spinner with the phase,
which opens the terminal; once the preview paints → `Running` (opens the preview) with `Stop`;
a run that dies before binding a port leaves `Start failed`, which opens the terminal. The title
bar keeps a Run/Stop twin and loses its panel toggle; the empty preview gains a `Run project`
CTA and the same failure state. `runProject` no longer opens the panel or focuses a terminal,
and `stopRun` closes only the terminal a run created (a hand-typed `npm run dev` is not ours to
stop).

**Consequences:** the first run is watched in the preview and the status bar, not the terminal;
a failed install is visible without opening anything; the run readouts (`runTerminalId`,
`runFailed`) live in the snapshot and `controller.ts` stays under its ratchet without growing
(the dead upstream demo-run path it replaced is gone); the touched chrome files were migrated to
`t()` (D-043) and are ticked in `ide/I18N.md`.
