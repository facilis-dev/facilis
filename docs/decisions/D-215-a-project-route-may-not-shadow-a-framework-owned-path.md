# D-215 — A project route may not shadow a framework-owned path
**Status:** accepted (2026-11-25)

Invariant 6 requires framework-owned paths to stay framework-owned: `@facilis.dev/nitro`
registers the control plane, the SSO namespace and the token endpoint itself in dev and
production (D-107/D-116/D-120). Nothing static stopped a project (handwritten or AI-written)
from putting a route file on one of those paths; the collision surfaced at runtime, as a
shadowed handler or a 404 depending on registration order. The runtime router remains the
security authority — this is an additive early warning over the same AST facts the IDE and the
AI validator already use (epic #168 design rule 1).

**Decision.** Check framework-owned paths statically as analyzer diagnostic
`reserved-route-prefix` and AI validator rule 23 `reserved-route-prefix` (error). A project
route is rejected when its derived route path is reserved, and a route file under
`server/{routes,api}/__facilis/**` is rejected on its location. Only project route trees are
scanned: `packages/nitro`'s own route files (`packages/nitro/src/routes/*`, plus the
runtime-registered SSO and telemetry handlers) are framework code and never facts of a project.
The reserved list is pinned in `packages/analyze/src/reserved-route-paths.ts` from
`@facilis.dev/nitro`'s route constants, and a test fails when a `*_ROUTE` constant there is
not covered. Additive: no runtime routing changes.

**Mechanism.**

- The reserved set, in the order it appears in `packages/nitro/src/constants.ts` and
  `runtime/sso.ts`:
  - `/__facilis` as a **prefix** — `MANIFEST_ROUTE`, `MANIFEST_REVISION_ROUTE`,
    `HEALTH_ROUTE`, `DEV_SCHEMA_ROUTE`, `DEV_QUERY_ROUTE`, `DEV_VIEW_ROUTE` and
    `TELEMETRY_TRACES_ROUTE` (D-116/D-203);
  - `/_openapi.json` exact — `OPENAPI_FACADE_ROUTE`;
  - `/_facilis/openapi.json` exact — `NATIVE_OPENAPI_ROUTE` (dev-only internal);
  - `/api/auth/sso` as a **prefix** — `SSO_ROUTE` (`/api/auth/sso/**`, D-120) and the
    `SSO_ROUTE_PREFIX` in `runtime/sso.ts`;
  - `/api/auth/token` exact — `TOKEN_ROUTE` (D-142/D-143).
- Prefix matching stops at a segment boundary, so `/__facilisx` and
  `/api/auth/tokenizer` stay ordinary app paths; exact matching keeps
  `/api/auth/verify-email` (D-156) an app route.
- `packages/analyze/src/passes/route-reserved-prefix.ts` reads the route facts only (the path
  Nitro's file router derives and the source file). A file under
  `server/{routes,api}/__facilis/**` derives a `/__facilis/**` path, so the path rule covers
  it; `routes-gate.test.ts` additionally asserts the file location directly, and the two checks
  are deduplicated per file.
- `reserved-route-prefix` is wired into `analyzeProject`'s diagnostics, so the IDE graph and
  every consumer of `Analysis.diagnostics` see it. AI rule 23 consumes the effective post-patch
  `Analysis.routes` (overlay facts, never a re-parse of the patch text): a patch that creates a
  reserved route is blocked before it touches the VFS.
- **Narrower reading of "files, jobs" (recorded).** The issue's context mentions files and jobs
  (D-107/D-116/D-120). The framework registers **no** handler under `/api/files/**` or
  `/api/jobs/**`: `@facilis.dev/storage` only builds `/api/files/<id>` URLs for app routes, and
  `examples/todo-app` owns `/api/files/[id].get.ts`, `/api/jobs/index.post.ts` and
  `/api/jobs/[id].*`. Reserving those prefixes would flag the shipped examples and require
  exemptions for app routes, so the rule reserves only paths the framework actually registers;
  the omission is a deliberate additive choice, not a claim that those trees are framework-owned.
- `packages/analyze/src/reserved-route-paths.test.ts` parses the route constants from
  `packages/nitro/src/constants.ts` and `runtime/sso.ts` and fails when one is not reserved,
  so a new framework route forces a deliberate decision here. The analyzer cannot import
  `@facilis.dev/nitro` (that package depends on the analyzer), hence the pinned list plus the
  drift test rather than a direct derivation.

**Rejected.** Reserving `/api/files/**` and `/api/jobs/**`: the framework registers no handler
there and the shipped examples legitimately own them (see above). Inspecting patch paths in the
validator instead of the effective Analysis: epic design rule 2 requires facts, not patch text.
Flagging a whole directory instead of the derived path: the file router is the source of truth
for the served path, and a path rule stays correct if the route directory layout changes.
Making the finding a warning: a shadowed framework handler is a routing defect, and the shipped
apps and examples are green today, so the error costs no existing project. Treating an
unreadable route location as a finding: a file whose name yields no path has no route fact, the
existing "not a Nitro route location" gate violation covers it, and guessing is not allowed.

**Consequences.** Additive; rollback is the removal of the pass, the rule and the SPEC rows. The
validator is now 23 rules and every current rule-count reference moves with it (historical
decision records keep the count of their time). No shipped example changes: `/api/auth/*`,
`/api/files/**` and `/api/jobs/**` stay green. A new framework route needs its constant added
to the reserved list (the drift test fails otherwise), which keeps the early warning honest.
Routing order remains the runtime authority; the rule only reports before disk.

**Verification.** `packages/analyze/src/passes/route-reserved-prefix.test.ts` (control plane,
OpenAPI documents, SSO namespace and token endpoint errors; `/api/auth/login`,
`/api/files/{id}`, `/api/jobs` and `/api/todos` pass; lookalike segments pass; message and
source); `packages/analyze/src/reserved-route-paths.test.ts` (every Nitro route constant is
covered, app trees are not reserved, reserved directories are detected);
`packages/ai/src/validator-reserved-route-prefix.test.ts` (reserved creates block, app routes
and lookalikes pass); `packages/analyze/src/routes-gate.test.ts` (failing `__facilis/x.get.ts`,
OpenAPI, token and SSO fixtures; passing app routes and a `packages/nitro` route file; the
shipped examples stay zero-violation); `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`.
