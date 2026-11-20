# D-069 — The product presents itself as Facilis Studio; the upstream name stays in provenance
**Status:** accepted (2026-11-01)

The IDE is a fork of Vivari Studio (D-011) and inherited that name in its user-visible
surface: the document title, the title bar, the tab title, the runtime toast and the
Service Worker's synthesized preview screens ("Connecting to Vivari…", "Keep the Vivari
editor tab open"). Someone using `facilis.dev` must never be told they are running
someone else's product.

**Decision.** Every user-visible string says **Facilis** (or Facilis Studio) and the shell
points at `https://facilis.dev` (title, meta description, canonical link). The brand is a
catalogue message (`app.name`), not a JSX literal. The Vivari name survives only where it
is a fact rather than a label:

- attribution and provenance (LICENSE, `ide/README.md`, D-011, D-030);
- package and module identifiers (`@vivari/core`, `vendor/vivari/**`), which are the
  kernel's real names and would need a fork-wide rename;
- internal identifiers and protocols (`__vv*`, `vv-*`, `host.vivari.internal`), which are
  wire and storage contracts inside the kernel.

`ide/public/sw.js` is the one file that must stay in sync with the upstream copy: its
routing logic stays identical and only its brand strings diverge, noted at the top of the
file so a future upstream sync cannot quietly reintroduce the old name.

**Consequences:** the deployed IDE shows Facilis from the first paint, in the tab title
(which follows the locale), in the preview boot/error screens and in the runtime failure
toast; grepping `ide/src` and `ide/public` for "Vivari" returns only provenance comments and
kernel identifiers. The vendored kernel can still print its own brand in deep error
messages; renaming that belongs to the fork, not to this app.
