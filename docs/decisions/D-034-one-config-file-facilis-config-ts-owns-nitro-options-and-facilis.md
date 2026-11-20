# D-034 — One config file: `facilis.config.ts` owns Nitro options, and `facilis()` mounts Nitro
**Status:** accepted (2026-10-29)

A project carried two config files for one runtime: `facilis.config.ts` for the framework and a
`nitro.config.ts` that every generated project copied — `serverDir: "./server"` and
`experimental.openAPI: true` — plus a `vite.config.ts` that imported `nitro()` itself. That is
two committed files expressing framework defaults, and a registration order for a user to get
wrong (SPEC §13 risk 12).

**Decision:** a Facilis project has **one** config file, `facilis.config.ts`, and never names
Nitro in `vite.config.ts`.

- `facilis.config.ts` gains an optional **`nitro`** section: pass-through Nitro options, which
  `@facilis.dev/core` validates only as an object (`FacilisNitroOptions =
  Readonly<Record<string, unknown>>`) because they are Nitro's options, not the framework's. A
  project declares only what it overrides.
- Facilis applies the framework defaults underneath — `serverDir: "./server"` and
  `experimental.openAPI: true` — in `@facilis.dev/nitro`'s `mergeNitroOptions`, deep-merged for
  plain objects (so `experimental: { openAPI: false }` flips that switch and keeps the rest of
  the block).
- `facilis()` from `@facilis.dev/nitro/vite` **mounts Nitro itself**: it returns
  `FacilisPlugins = [FacilisVitePlugin, ...Plugin[]]` — the Facilis plugin first
  (`name: "facilis"`, `enforce: "pre"`, carrying the Nitro module on its `nitro` key),
  followed by `nitro()`'s plugins.
- The Facilis plugin's Vite `config` hook loads `<root>/facilis.config.ts` with a native
  dynamic import and returns `{ nitro: mergeNitroOptions(config.nitro) }`. `enforce: "pre"`
  makes its config hook run before Nitro's, so Nitro boots with those options and the order
  inside the user's `plugins` array cannot matter.
- `@facilis.dev/nitro` value-imports `nitro/vite`, so `nitro` is a **required** peer dependency
  (`vite` stays optional: only the `/vite` entry needs it).

**Consequences:** the generated project, the starter and `examples/todo-app` ship no
`nitro.config.ts` and no `nitro` import; their plugins are `[facilis(), react()]`. The IDE's
generated template keeps `nitro: { devServer: { runner: "self" } }` in `facilis.config.ts`
because Nitro's default node-worker runner needs `worker_threads` and a file-URL
`import.meta.resolve`, neither available in the WebContainer — an environment constraint, not
a framework default (D-024). A project that still keeps a `nitro.config.ts` keeps working:
Nitro's own c12 loader reads it, but `facilis.config.ts` wins; new projects never create one.
The template's `package.json` also pins `@types/react` / `@types/react-dom` 19.3.0, because
the IDE's Monaco TypeScript service only knows installed `@types/*.d.ts` — the report that
started this pass was TS2307 "Cannot find module 'react'".

**Why:** Nuxt parity — one committed config — and framework defaults belong in framework code,
not copied into every project. `vite.config.ts` stops naming Nitro at all.

**Alternatives rejected:** requiring `facilis(config)` with `import config from
"./facilis.config"` (still two references in the Vite config, plus a cast for untyped Nitro
options); an async `facilis()` that returns a plugin promise (works, but keeps config loading
on a less-tested Vite path).

**Verified:** a `resolveConfig` probe showed the pre-plugin `config` hook's `nitro` key
reaching Nitro's `setupNitroContext` (server directory resolved, `experimental.openAPI` true),
with `nitro()` listed before or after `facilis()`.
