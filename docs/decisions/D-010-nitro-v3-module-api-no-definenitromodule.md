# D-010 — Nitro v3 module API: no `defineNitroModule`
**Status:** accepted (2026-10-25)

Spec §5.6 and Appendix E show `import { defineNitroModule } from "nitro/kit"`. That export
**does not exist** in the pinned `nitro@3.0.260903-beta`: there is no `./kit` entry, and
Nitro v3 migration docs state modules are plain objects. Verified against the installed
package:

- a module is `{ name, setup(nitro) }`, typed as `NitroModule` from `nitro/types`;
- `Plugin.nitro?: NitroModule` is declared by `nitro/vite` (so `facilis()` can carry it);
- `nitro()` returns a `Plugin[]`, and `defineHandler` is an identity wrapper (a plain
  async function is a valid route handler).

**Consequences:** `@facilis.dev/nitro` implements the plain-object module; the spec snippets are
corrected in the Phase 1 docs pass. No behaviour change to the design.
