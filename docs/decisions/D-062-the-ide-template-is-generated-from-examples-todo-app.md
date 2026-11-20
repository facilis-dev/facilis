# D-062 — The IDE template is generated from examples/todo-app
**Status:** accepted (2026-11-01). The template's UI is v2 since **D-090**; the single-source rule
below is unchanged.

The base kit restyled and reorganised `examples/todo-app` (pages/layouts/lib, `@facilis.dev/ui`,
`@facilis.dev/time`, router), but the IDE still scaffolded its own probe app: different client
files, plain CSS, no kit, no router. The starter users get and the reference app they should
copy had drifted apart, and the base-kit contract left the wiring explicitly out of scope
("wiring the packages into the IDE template" was reported, not done).

**Decision.** The generated project IS `examples/todo-app`, not a copy of it. At IDE build time
`ide/src/facilis/example-template.ts` inlines the example's `src/`, `server/`, `db/`,
`locales/`, `index.html`, `vite.config.ts` and `facilis.config.ts` through
`import.meta.glob(..., { query: "?raw" })`; `facilis-template.ts` then assembles example files
+ IDE wrappers + a small override map (`template-overrides.ts`). The wrappers are the only
files written by hand: `package.json` (built from the example's versions, with `@facilis.dev/*`
rewritten to vendored tarballs plus the in-VM extras), the standalone `tsconfig.json`,
`.npmrc`, README and the npm hooks. The overrides are the few places the IDE cannot take the
example verbatim: add the HMR hint plus its `.muted` style to `app.tsx`/`styles.css`, and
the in-process Nitro runner + `main` release ref to `facilis.config.ts`. Each
override is an anchored replacement that throws when the anchor disappears, and
`example-template.test.ts` asserts every untouched example file is byte-identical, so an
example refactor fails the IDE suite instead of generating a different app.

The probe is not in the generated app at all: `scripts/dev/smoke-facilis.mjs` drives the
framework endpoints from the IDE page against the preview's same-origin
`/preview/<port>/` base (so the session cookie the login sets applies), which keeps a
user's starter free of test instrumentation — it never auto-registers a probe user or
inserts probe rows. The only IDE-only route is the public liveness `ping` the write smoke
edits. `@facilis.dev/time` and `@facilis.dev/ui` join the vendored tarball set
(`TEMPLATE_PACKAGES`, `scripts/dev/vendor-facilis-deps.sh`), and `ide/vitest.config.ts`
enables `test.css` so `?raw` CSS is real in tests instead of Vitest's empty stub.

Two supporting fixes came out of making the starter real. The IDE language service now uses
TypeScript's `Bundler` module resolution instead of classic NodeJs: the generated app imports
its own packages through `exports` maps (`@facilis.dev/ui`, `@facilis.dev/core/i18n`), which node10
ignores — every such import would be a red TS2307 in the editor, and the IntelliSense smoke
now proves it does not. The vendor packer, in turn, mirrors each package's root export as
`main`/`types` and rewrites `.d.ts` relative specifiers to the emitted `.js` (and drops CSS
imports), because declaration emit preserves the source `.tsx` specifier, which cannot be
resolved out of `dist/`.

**Consequences:** editing `examples/todo-app` changes what "New project" scaffolds, and the
generated app opens on the todo login page rather than a probe page; the smoke's HMR edit now
targets `src/app.tsx`. The generated `vite.config.ts` keeps the example's dev-vhost
`allowedHosts` (dev-only, harmless) and its `release.ref` becomes `main` instead of
`origin/main`. `starter/` stays empty until `@facilis.dev/*` has a publish target (D-027).

**Verification:** `example-template.test.ts` (drift guard, overrides, tarball deps);
`starter-contract.test.ts`, `project-files.test.ts` and `package-manager.test.ts` updated to
the assembled template; `pnpm --filter @facilis.dev/ide typecheck|test|build`;
`pnpm ide:facilis-deps`; `pnpm ide:smoke` (endpoints driven from the IDE page, IntelliSense
on the router/kit imports, HMR, server reload, database roundtrip).
