# D-168 — Project templates are a registry: a picker of example-backed kinds, one descriptor each
**Status:** accepted (2026-11-12)

**Context.** D-051 made the IDE Facilis-only and left exactly one creation path: every new
project is the Nitro + PGlite + React todo app. The framework really is one, but "one generated
project" conflated it with the app a project starts as: a project can be the full-stack todo
reference or a static Vite + React + Tailwind site that boots no backend, and Home's dialog
claimed Nitro + PGlite + React even for the static one. Assembly was already "example sources
inlined at build time + IDE wrappers" (D-062), so a second kind is a descriptor and a module,
not a fork of the pipeline.

**Decision.**

- `src/facilis/templates.ts` is the registry: `TemplateKey = "todo" | "showcase" | "starter"`,
  `TemplateDescriptor { key, id, labelKey, descriptionKey, load() }`, `FACILIS_TEMPLATES` (todo
  first = default), `templateForCreate` and `templateForStoredId`. `id` is the manifest id
  ProjectMeta stores: the todo template keeps `"facilis"` (existing rows and existing app
  markers), showcase is `"facilis-showcase"`, the empty full-stack template is
  `"facilis-starter"`.
- The admission marker keeps `template: "facilis"` for every variant: admission asks "is this a
  Facilis project", never which app it starts as, so `app-manifest.ts` is unchanged.
- `src/facilis/template-loader.ts` caches one promise per descriptor key and drops a rejected
  import so a retry is possible; each template stays its own lazy chunk, so Home's first paint
  carries no template payload.
- Assembly is generic (`src/facilis/template-files.ts`): example sources first, then the
  IDE-owned files (marker, generated package.json, standalone tsconfig, `.npmrc`, README,
  `scripts/check-pm.mjs`) and per-template overrides. A descriptor contributes only its example
  sources and wrappers. The todo template keeps its overrides (ping route, HMR hint/style, in-VM
  Nitro runner) and the full-stack package wrapper: `TEMPLATE_PACKAGES`, workspace specs pinned
  to the published version (D-166). The static template ships the example's own package.json
  plus only the VM constraints — the vendored npm with its preinstall guard (D-032) and the
  wasm32 rolldown/Tailwind bindings (DEV.md 6.1); it has no `@facilis.dev/*` dependency.
  The empty full-stack template reuses the full-stack wrapper and adds only the in-VM Nitro
  runner to `examples/starter-app` (the example deliberately leaves that VM constraint out).
- `openProject` resolves the stored `meta.template` through the registry instead of always
  registering the todo manifest; a row from the removed 55-template catalog (D-051) resolves to
  nothing and still opens as an editor (Run drops into a shell). Imported/shared projects keep
  the synthesized-manifest path.
- Home's New project dialog has a radio-card picker over `FACILIS_TEMPLATES` (default todo,
  labels and descriptions in `en`/`it`) and passes the key to
  `createProject({ dir, runInit, template })`; `project-scaffold` accepts an optional key with
  the same default.

**Why.** The framework contract does not change, only the app a project starts as. One
descriptor per kind keeps the picker entry, the stored id and the lazy loader in one record, so
a template cannot be half-registered (a picker entry with no loader, or an id no reopen can
resolve), and it extends the D-062 drift guard to every variant: the generated project is still
the example, byte for byte, plus the files the IDE owns.

**Consequences.** Home shows one creation card with a picker rather than an implied single
template. The static template's run manifest is plain `vite dev` on port 3000
(`--configLoader native` for the VM), so preview and graph behave the same with no Nitro
process to boot; the graph simply has no routes/tables for it. The empty full-stack template
(`starter-template.ts`, its `import.meta.glob` over `examples/starter-app`) reuses the
full-stack wrappers — the generated `package.json` pins the same framework packages — and
adds only the in-VM Nitro runner: the example ships the standard login surface (auth routes,
pages, schema and migrations) and no demo page, route, table or job. `templateForCreate` still
falls back to the default for a key whose descriptor is absent, so a build without one keeps
creating and opening the others.
D-051 is superseded only on the "no template catalog" point: the product is still Facilis-only,
with no blank project and no second framework.

**Verification.** `pnpm --filter @facilis.dev/ide test` — `templates.test.ts` (registry,
manifest-id/manifest parity, legacy `"facilis"` fallback, unshipped-key fallback),
`template-loader.test.ts` (one load per key, retry after a rejected import),
`showcase-template.test.ts` (static contract: no server/db/config, package.json without
`@facilis.dev/*`, VM bindings, marker/tsconfig/README/check-pm), `starter-template.test.ts`
(login-only contract: auth routes/schema/migrations, no todo/file/job surface, VM Nitro runner)
and the unchanged todo contracts
(`starter-contract.test.ts`, `example-template.test.ts`, `package-manager.test.ts`).
`pnpm --filter @facilis.dev/ide typecheck` and `pnpm lint` cover the split modules;
`pnpm ide:smoke` drives the dialog (pick a template, create, run).
