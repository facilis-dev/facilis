# D-199 — Service API calls count as table usage; the declaration error stays on the db clients
**Status:** accepted (2026-11-20)

**Context.** D-157/D-162 made `dbTables` an applied declaration for `ctx.db`/`ctx.sudo`/`ctx.system`
and for job bodies. The workflow layer (D-135) added `ctx.tasks`/`ctx.workflows`: server-only service
APIs bound to the request's policy-scoped transaction, whose stores touch a fixed set of tables
(`facilis_tasks`; `facilis_workflows` + `facilis_tasks`). The route-relations walk understood only db
clients, so a route that correctly declared the service tables and used only the service API earned a
false `route-table-unused` warning: `examples/todo-app` booted with 4 warnings and the `ide:smoke`
check "facilis manifest warnings 0" was red on `main` (issue #106). The in-VM manifest carried two
more warnings the issue could not identify: `route-elevation-static` on
`server/routes/api/auth/verify-email.get.ts`, whose elevation `tables` option is the package constant
`EMAIL_VERIFICATION_TABLES` from `@facilis.dev/auth`.

**Decision.**

- **The analyzer learns the fixed service surface.** `ctx.tasks` → `facilis_tasks`; `ctx.workflows` →
  `facilis_workflows` + `facilis_tasks` (`SERVICE_TABLES` in `@facilis.dev/analyze`, exported for the
  AI validator). The walk resolves a service handle like a db client — `ctx` member, destructured
  (also renamed), local alias, argument of a project-local helper — and records one
  `RouteServiceUse` per service on `RouteRelationsFact.services`. `ctx.jobs` stays unmapped: the queue
  store is framework code, not a project db surface (D-162).
- **Diagnostics.** The service surface counts as usage for `route-table-unused` (the analyzer and AI
  rule 18 agree). It does **not** extend `route-table-undeclared` or rule 18's error: the runtime guard
  wraps `ctx.db` and the elevation callbacks, while the service stores run on the same scoped
  transaction as framework code. Enforcing their declaration would be a new contract, not a bug fix.
  A service handle passed to a project-external callee keeps the existing opaque suppression.
- **The fs loader reads installed framework code.** `loadProjectFiles` skipped `dist/` everywhere, so a
  vendored (D-196) or registry install — which ships no `src/` — left the framework bindings invisible
  to the static passes, and the elevation constant above could not be resolved. Under the allowed
  `node_modules` scope, `dist/` is now loaded: it is the code the project actually installs, not build
  output. The project's own `dist/` stays skipped. Framework tables and package constants now resolve
  identically in the workspace, the dev vendoring and a registry install.
- **Gates.** The CI route gate additionally pins zero `route-table-unused` warnings on `examples/` and
  `starter/` — the Node-side counterpart of the smoke's "manifest warnings 0". The smoke diagnostics
  now carry the warning bodies, not only the count, so a red check names the flagged declarations.

**Rejected.** *Adding the service tables to `used`*: fires `route-table-undeclared` and rule 18 on
routes the runtime does not guard — a contract extension disguised as a bug fix. *Suppressing the
unused warning wholesale when a service is present*: hides genuinely unused declarations. *Deriving
the surface from the runtime store code*: the analyzer is static and browser-safe; the fixed mapping
is the contract (WORKFLOWS §7), recorded here.

**Consequences.** `RouteRelationsFact` gains `services` (additive; rule 18 tolerates a pre-D-199 IDE
snapshot without the field). SPEC §7.4 and WORKFLOWS §7 state the semantics. A route that declares the
service tables it uses boots with 0 warnings; declaring them stays documentation of real access —
reviewed, not guard-enforced.

**Verification.** `route-relations.test.ts` (service cases), `routes-gate.test.ts` (zero-unused pin),
`validator-relations.test.ts` (rule 18), `fs.test.ts` (framework dist loading); a synthetic vendored
layout (manifest + dist only, rolldown parser) reproduced the two `route-elevation-static` warnings
before the loader change and reports 0 after, as does `examples/todo-app`; `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm ide:smoke` green (issue #106).
