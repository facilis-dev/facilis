# D-049 — A reloaded tab boots into its project, never Home
**Status:** accepted (2026-10-31)

A tab's URL already names the project it shows (`?project=<rootPath>`, D-035), but the
snapshot always started on `home` and switched to `workspace` only after the kernel booted
and the bootstrap pass opened the project. Every reload therefore painted the project picker
first and then swapped to the IDE — a visible, avoidable jump, and one that invited a click on
"New project" during the swap.

**Decision.** The first paint's view is derived from the URL (`boot-target.ts`, pure and
tested): `?project=` — or a `#share=` payload — starts on `workspace`; everything else on
`home`. The project-opening pass is a snapshot field (`bootProject`): while it is non-null a
blocking overlay shows the boot progress, and it is cleared once the project is open, or when
the pass gives up (the project is missing from the registry or is claimed by another tab) —
in which case the tab goes Home rather than lingering on an empty workspace.

**Consequences:** no Home flash on reload; the URL remains the single source of truth for what
a tab shows, so a tab opened with `?project=` behaves like a reload. The overlay blocks
interaction until the project is open: an empty IDE is much easier to misread than a spinner.

**Verification.** `boot-target.test.ts` pins the URL cases. The smoke's A12 reload step
asserts the reloaded tab starts in the workspace with the project named in its URL, not on
Home.
