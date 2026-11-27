# D-226 — Declared security surface: no silent authority
**Status:** accepted (2026-11-27)

**Context.** SPEC §8.2 says every API route goes through `defineAuthorizedHandler`, and the analyzer
has reported an unwrapped route for a while — but the report was advisory: the Vite plugin only
warned, Nitro still mounted the file, and the request reached a handler that could read
`event.context.facilis.db`. That object was the root Drizzle client: a superuser in the dev PGlite,
and in production `facilis_app`, which can set the `app.*` GUCs and `SET ROLE facilis_system`
(BYPASSRLS) because `ensureSystemRole` grants the membership. `server/plugins` and
`server/middleware` were outside every rule entirely; the 23-rule validator only inspects AI
patches, and the D-154 gate covers only the examples in this repository.

The product position agreed for this epic: **the project author may do anything, but every
non-standard capability must be declared in the code that uses it, resolved by the analyzer, shown
in the IDE, and exported for the security review.** No silent authority.

**Evaluation.**

- *Keep the wrapper as the only path.* Rejected: legitimate projects need signed webhooks,
  streaming bodies and vendor protocols that the standard pipeline cannot model. A rule with no
  escape hatch is bypassed, not obeyed.
- *Allow an escape hatch with a config flag.* Rejected: a flag in `facilis.config.ts` is invisible
  at the call site, survives refactors and cannot name the reason. The declaration must live where
  the capability lives.
- *Remove the raw client but keep `event.context.facilis` for jobs/tasks.* Yes: the wrapper still
  needs the root client, so it moves to a module-private WeakMap keyed by the request event. Jobs,
  tasks, storage and logging stay on the context because they are framework APIs, not a database.
- *Trust the analyzer alone.* Rejected as the only layer: the analyzer can be fooled by a parser
  version or a shadowed import. A runtime brand proves the mounted value came out of the DSL.
- *Trust the runtime alone.* Rejected: a capability that boots is not reviewable after the fact.
  The static fact is what the export and the IDE show.

**Decision.**

1. **Four classes, one green.** Every surface is `standard`, `declared`, `undeclared` or
   `unknown`. Only `standard` is green; `declared` is amber and exported; `undeclared` and
   `unknown` fail closed for routes and database facts.
2. **Declarations are code with a reason.** A declaration is a call the analyzer resolves —
   `defineRawRoute({ reason, auth })`, `defineServerExtension({ reason })`,
   `rawSql: { reason }`, `ctx.rawDb({ reason })` — with a non-empty reason. There is no owner,
   expiry or ticket field: the reason is the proof. A malformed declaration throws at definition
   time and is reported by the analyzer.
3. **No ambient authority.** `FacilisEventContext.facilis.db` is removed. The request client is
   attached by the Nitro context middleware through core's module-private WeakMap
   (`attachRequestDatabase`) and read only by the wrapper and the transaction it opens. A handler
   sees `ctx.db` (guarded, policy-scoped), `ctx.rawDb` (declared, audited), `ctx.sudo` and
   `ctx.system` (audited elevations). A raw route has no `ctx.db` at all.
4. **One fact set.** `Analysis.surface` and each `RouteFact.surface` feed the IDE graph, the mount
   allowlist, the build gate and the release export. Nothing re-classifies a site.
5. **Mount only what is declared.** The Nitro module filters `handlers`, `scannedHandlers`,
   `plugins`, `modules` and `tasks` against the analyzer allowlist before routing sync; the
   filter is reapplied on every dev rescan. An undeclared route answers 404 (never mounted); a
   production build fails on `undeclared`/`unknown` routes, extensions, forbidden imports and
   dynamic code. Dev reports the same issues as warnings and keeps the 404 fallback.
6. **Raw routes keep the request protections.** `defineRawRoute` skips Zod and may skip the session
   only with `auth: "none"` plus the reason; CSRF/origin validation, rate limiting and request
   logging stay. `rawSql: true` is the legacy undeclared shape and is rejected; the declared form is
   `rawSql: { reason }`.
7. **AI never writes a declaration alone.** The model writes the declaration with a generated
   reason; `validatePatch` returns `surfaceRequests` (capability, snippet, line, reason) instead of
   accepting silently. The IDE pauses before the write, shows an editable reason, and only a
   confirmed write is validated again (`confirmedSurface: true`) and persisted. A declaration may
   carry optional `confirmed: { at, by }` provenance.
8. **Runtime brand.** `defineAuthorizedHandler`, `defineRawRoute` and `defineServerExtension`
   mark their return value in module-private WeakSets; `isFacilisRouteHandler` /
   `isFacilisServerExtension` expose the predicate. A lookalike default export is never branded.
9. **The db package is not a capability.** Project code may import declarative helpers and types
   from `@facilis.dev/db`; `createDb`, `runAs*` and `ensure*` are forbidden (named or namespace
   imports). The analyzer reports them; no declaration can legalize them.
10. **Dynamic code is declared or blocked.** `eval`, `new Function` and computed `import()` are
    undeclared surface unless a `// dynamic-code: <reason>` marker sits on the line above. Dynamic
    code is never green.
11. **The export is versioned and deterministic.** Builds emit `security-surface.json`
    (`version: 1`) next to the server output; the dev route `/__facilis/security-surface.json`
    serves the same bytes for the IDE download. Fields: `project`, `revision`, `summary`
    (counts by class), `routes` (path, method, class, auth, permission, dbTables, declarations with
    reason/file/line, source, warnings, unknown), `extensions`, `imports`, `dynamicCode`,
    `unknown`. No timestamp, sorted arrays: the same commit produces the same bytes. Additive
    fields keep version 1; a breaking change bumps it.
12. **Unknown is explicit.** `unknown` is a first-class bucket and a route/extension with an
    unreadable declaration is never counted as standard. `process.env`, `fetch`, the filesystem and
    `ctx.jobs`/`tasks`/`workflows`/`storage` remain framework surfaces and are out of scope.

**The fail-closed matrix.**

| Site | Build | Dev | Mount |
| --- | --- | --- | --- |
| Authorized route | pass | serves | standard |
| Declared raw route/extension/rawSql/rawDb | pass, exported | serves, exported | declared |
| Undeclared route/extension | fail | warns, 404 | not mounted |
| Unreadable route fact | fail | warns, 404 | not mounted |
| Forbidden db import | fail | warns | route not mounted if route file |
| Undeclared dynamic code | fail | warns | source still runs; reported |

**Consequences.** `rawSql: true` and a raw Nitro default export are now breaking: the build fails
and the route is not mounted until the project declares the reason. The shipped examples use only
`defineAuthorizedHandler` with no raw SQL, so they stay green. The IDE gains one confirmation card
and one download; the security review gains one stable file per release. The cost is a new
confirmation step for AI-authored capabilities and a mount-time analyzer pass per rebuild — accepted
because the alternative is a framework that only documents its invariant.

**Non-goals.** A deploy-time policy engine; per-declaration approval in `facilis.deploy.json`;
covering `fetch`, environment reads or storage; a second analyzer for the IDE. Those remain
D-204/D-224 territory and are deliberately not part of this decision.
