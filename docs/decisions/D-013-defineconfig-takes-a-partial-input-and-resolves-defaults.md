# D-013 — `defineConfig` takes a partial input and resolves defaults
**Status:** accepted (2026-10-25)

Spec §7.1 declares the fully-resolved `FacilisConfig`, but §8.4.1 shows a `facilis.config.ts`
containing only `auth`. Adopted: `defineConfig(input: FacilisConfigInput)` with `auth`
required and every other section optional, resolving documented defaults (release `main`;
db pglite, `./drizzle`, tenant/owner column aliases; i18n `en`; no block packages; 7-day
sessions). Objects are strict (unknown keys rejected) and the auth block is cross-checked:
every permission a role references must be declared, `"*"` is valid only as a role entry,
`defaultRole` must exist. `facilisConfigSchema` validates the input form; the output is the
full `FacilisConfig`.

**Consequences:** `facilis.config.ts` stays short, typos fail at boot with a readable error,
and `@facilis.dev/nitro`/`@facilis.dev/db` always consume the resolved shape.
