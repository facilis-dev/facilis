# D-076 — The IDE is installable as a PWA; no app-shell cache yet
**Status:** accepted (2026-11-01)

The Studio is a static SPA, so installability is a manifest, two icons and a link. Chrome no
longer requires a service worker with a fetch handler to install from the menu (mobile 108 /
desktop 112), and the preview SW is already registered at root scope with
`Service-Worker-Allowed: /`; the preview relay is untouched.

**Decision.** `ide/public/manifest.json` declares `id`, `start_url` and `scope` at
`/`, `display: standalone`, the ink theme/background colour and 192/512 PNG icons derived
from the app icon. `ide/index.html` links it and adds the mobile/iOS standalone metas;
`pwa-manifest.test.ts` pins the fields and checks each declared icon size against the PNG's
own IHDR. It is `.json` rather than `.webmanifest` so any static host serving JSON MIME
types gets it right without a per-host mapping (the spec allows any JSON MIME); the name is
`facilis.dev`, for the same origin the app already runs on.

**Consequences.** The IDE installs from the address bar in both profiles; a managed deployment
gets the same manifest on its dedicated origin. Installation does NOT add offline support: the
preview SW still passes every non-preview request to the network by design, so a managed build
cannot serve a stale shell past its approved baseline (D-065/D-070). An app-shell cache is a
separate decision and must be network-first for navigations before it is safe for managed.
