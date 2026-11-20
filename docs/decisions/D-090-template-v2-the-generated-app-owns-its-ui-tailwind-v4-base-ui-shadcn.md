# D-090 — Template v2: the generated app owns its UI (Tailwind v4 + Base UI + shadcn source)
**Status:** accepted (2026-11-03)

D-055 made the generated app's UI a plain-CSS kit (`@facilis.dev/ui`) because the project had no CSS
framework and the kit had to survive as a tarball. That solved shipping, but left generated apps
outside the standard React UI ecosystem: the kit could only grow by adding components and props,
the visual line went stale, and the catalog of reusable sections the product needs would have had
to be built on a private kit instead of component source a project can read and edit.

A WebContainer spike answered the two open questions. The shadcn substrate installs and runs in the
VM: `tailwindcss`/`@tailwindcss/vite`/`@tailwindcss/oxide-wasm32-wasi` 4.3.3 and `@base-ui/react`
1.9.0 install with plain npm (`process.arch` is `wasm32`, so the WASI oxide is a normal match), Vite
8 serves, utilities are generated and Base UI renders; the cold-create cost is about +5–8 s and
+42 MB in `node_modules`. The one defect is upstream: Tailwind's WASI incremental scanner does not
pick up a **new** utility class after a source edit until the CSS entry is touched
(tailwindlabs/tailwindcss#20605, open). It is a dev-server-only problem, and making the
stylesheet's mtime move is the reliable workaround: it forces @tailwindcss/vite to recreate its
compiler and scanner, which then sees the new candidates.

**Decision.** The scaffold the IDE generates is **template v2**: React 19 + Tailwind CSS v4 + Base UI,
with shadcn-style components copied into the project as source.

- **The app owns its UI.** `src/components/ui/*` (button, input, field, select, dialog, card, table,
  badge, avatar, spinner, skeleton, alert, page/auth shells, sonner toaster) plus `src/lib/utils.ts`
  (`cn`) are project files, generated once and then edited like any other page component. There is
  no UI-kit tarball in a v2 project and no shadcn CLI at runtime or in the template: shadcn is
  component source, not a re-exportable library.
- **Theme is shadcn's role vocabulary with the Facilis direction-A values.** `src/styles.css` imports
  Tailwind, maps `--color-background|card|primary|muted|border|ring|…` in `@theme inline`, and keeps
  complete `:root`/`[data-theme="light"]`/`[data-theme="dark"]` sets. `data-theme` stays the switch
  (the app persists it), so a theme is still one variable block and no component names a colour.
- **Dependencies are pinned, and the VM binding is generated-only.** The project declares
  `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`, the
  Geist font and `tailwindcss`/`@tailwindcss/vite`; the IDE adds `@tailwindcss/oxide-wasm32-wasi` at
  the **same exact version** to the generated `devDependencies` only. Putting it in the example
  breaks the host install (`EBADPLATFORM`, `cpu: wasm32`), and a version skew between the compiler
  and the binding is the failure mode to avoid.
- **HMR was worked around, not forked — removed in Tailwind 4.3.5.** `vite-plugins/tailwind-rescan.ts`
  was a dev-only Vite plugin that ran only in the VM (`process.arch === "wasm32"`); after a
  debounced source change it rewrote `src/styles.css` with its own bytes, and the mtime change made
  `@tailwindcss/vite` recreate its compiler and scanner. Tailwind 4.3.5 fixed the WASI scanner
  (tailwindlabs/tailwindcss#20605), so the plugin, its `vite-plugins/` folder, the generated
  project's `@types/node` devDependency and the `node` tsconfig types were deleted. The
  verification below is the 4.3.5 run that closed it.
- **`@facilis.dev/ui` stays as the v1 kit.** Projects created before D-090 keep their import and their
  vendored tarball; the package remains for them, the UI gallery and the design lab. New projects
  do not receive its tarball. **Superseded by D-096:** the kit, both example apps and its
  documentation were removed; there is no v1 project to support.
- **The template is still examples/todo-app (D-062).** The single-source rule, the byte-identical
  drift test and the IDE override map are unchanged; only the example's UI layer moved.

**Rejected alternatives.** *Fork Tailwind*: a fork means maintaining WASI builds and re-applying a
patch on every upgrade for one dev-only scanner bug; the workaround is a few dozen lines and can be
deleted when upstream fixes it. Fork only if upstream stalls and the workaround regresses. *Proxy
shadcn inside `@facilis.dev/ui`*: shadcn is copy-in source, and Tailwind classes in `node_modules` need
precompiled CSS; a versioned tarball would have produced N divergent component forks. *Keep the v1
kit and add Tailwind alongside it*: two styling systems in one starter, and the catalog would still
depend on the private kit. *Ship the shadcn CLI*: the spike's CLI install was pathological in the VM
(~1 GB and >7 min without finishing) and a code generator is not a runtime dependency.

**Consequences.** Generated apps are editable, standard React/Tailwind code, which is the premise of
the copy-in catalog (a separate decision). The AI prompt, the generated README and the frontend docs
now teach the v2 paths; `@facilis.dev/ui` documentation is marked v1. A v1 project keeps working but does
not receive v2 components automatically; a migration is an upgrade recipe, not a forced rewrite.
The conformance cost is real: the tailwind trio must move together, and the `@facilis.dev/ui` kit will
eventually be retired instead of grown.

**Verification.** Browser run of the real Studio (CDP) on a project created from the IDE:
in-VM `npm install` (69 requests, 85.3 MB), Vite 8.3.5 dev, preview painted 120.7 s after create
(kernel online 1.4 s). The generated `package.json` has no `@facilis.dev/ui`; the Tailwind trio is
4.3.3 exactly and the oxide binding is generated-only; the preview paints the direction-A canvas
`rgb(247, 248, 249)` with Geist and no `.fc-*` class. Writing a new `bg-[#123456]` utility into
`src/app.tsx` through the VFS moved the computed background to `rgb(18, 52, 86)` without touching
`src/styles.css` (a reload-only workaround had failed first — the stylesheet mtime is what makes
the Vite plugin recreate its scanner). Host gates: example typecheck/test (33 tests)/lint/build,
IDE typecheck/tests (597), file-length OK. Evidence: `spikes/template-v2/` (report, screenshots).

**Amendment (2026-11-07, Tailwind 4.3.5).** The workaround is deleted. Re-running the Studio
harness against the final template — `vite.config.ts` with no `tailwindRescanInVm`, no
`vite-plugins/` folder, no generated `@types/node` — a new `bg-[#7c3aed]` utility written into
`src/app.tsx` through the VFS moved the preview's computed background to `rgb(124, 58, 237)` with no
stylesheet touch. Run: kernel online 1.5 s, preview painted 116.7 s after create, all 30 harness
checks green, the generated project asserted to ship no rescan plugin and no config reference, the
Tailwind trio all 4.3.5. Host gates after the removal: `pnpm lint` (0 errors), `typecheck`
19/19, `test` 19/19, `build` 12/12. The facilis.dev site carried the same copy and dropped it too
(separate repo, commit `e366de5`). Evidence: `spikes/tailwind-435/run.mjs` and its report
(artifact dir `/tmp/facilis-dev/spike-template-v2/1794038170654`, untracked).
