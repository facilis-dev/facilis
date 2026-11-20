# D-086 — Release Preview is a pure snapshot diff; the Studio reads the refs from the git tree instead of booting them
**Status:** accepted (2026-11-02)

SPEC §7.7 declared the `ReleasePreview` contract and SPEC §11.3 asked for four diff lenses, but
no engine existed (the types shipped with a "engine lands in Phase 3.5" note) and O-008 left the
boot strategy open (sequential boots vs `?at=<oid>`). `@facilis.dev/db` cannot host the browser-side
engine: it imports PGlite/Drizzle, and the Studio must never reach the database directly (§11.2).
Booting the project at an old commit to introspect it would be slow, would mutate the VFS and
would tie the preview to the runtime being healthy.

**Decision.** A pure engine over snapshots, and snapshots read from the git tree.

- **Engine.** `buildReleasePreview({ from, to, before, after, inUseRoutes?, pendingMigrations? })`
  in `@facilis.dev/core` (browser-safe, no I/O) returns the SPEC §7.7 `ReleasePreview`: schema
  statements with risk, schema summary, API diff, security diff, breaking changes and warnings.
  It is the one engine behind all lenses and is reusable by the Model B `get_release_preview`
  tool (§9.5).
- **Schema lens.** The schema statements are the migration files that ship between the two refs,
  split tolerantly (quotes, comments, dollar-quoted bodies) and classified statement by statement:
  `CREATE TABLE`/nullable `ADD COLUMN`/`CREATE INDEX`/`CREATE POLICY` safe; non-null without
  default, UNIQUE, renames, constraints, policy alterations careful; drops, type/nullability
  changes and RLS disable destructive. A drop becomes `breaking` when a route still references the
  table or column via `x-db-tables`/`x-db-columns` (the cross-check SPEC §11.3 asks for).
- **Other lenses.** API diff compares method+path across the refs and flags changed known fields
  (permission, dbTables, sourceFile). Security diff compares declared policies per table and
  reports RLS disabled on scoped tables; a policy whose SQL lost its `current_setting()` scope is
  a `policy_broadened` change. The working-copy lens finally feeds the code↔live drift from
  D-083's endpoint as the fourth view §11.3 lists.
- **No boots (resolves O-008).** The Studio reads `db/schema.ts`, `server/routes/**` and the
  migrations out of the VFS at `HEAD`/`origin/main`/tag with isomorphic-git (already a dependency,
  D-019) and parses the declarations with a tolerant text parser. Migrations are the source of
  schema statements, so the preview describes what will actually execute. The working-copy lens
  reads the live VFS through the controller and merges the manifest's routes for metadata.
- **Contract amendment.** `ApiDiff.changed` now matches §7.7 (`{ before, after, fields }`;
  the placeholder was an array). `ApiRouteRef.dbTables` is optional because a route derived from
  a filename at an old ref cannot know the handler's tables; an omitted field means "unknown at
  this ref", never "no tables". Both are documented on the type and in §7.7.

**Rejected alternatives.** Boot each ref (O-008's sequential-boots option): slow, mutates the
VFS, needs a healthy runtime, and fails exactly when the preview matters most (a broken ref).
Put the engine in `@facilis.dev/db` (SPEC §5.2's original location): it cannot run in the browser
bundle. Parse the TypeScript AST to recover `defineAuthorizedHandler` metadata at each ref: the
AST pass is Node-only and the routes' known metadata already comes from the manifest for the
working copy; method+path is enough to diff the API surface. Synthesize `CREATE TABLE` SQL from
the declared schema: the preview must show the SQL that ships, not invented SQL.

**Consequences.** No schema boot, no database dependency in the panel; the engine is deterministic
and cheap, and the panels pay only the git/blob reads when opened. Limits are declared: column
types and renames surface only through migration SQL, so an un-migrated schema edit is caught by
the code↔live lens rather than the summary; a ref-derived route knows only method+path; policy
clause changes need both sides to carry policy SQL; `origin/main` exists only after a fetch, and
the remote lens says so instead of guessing. The working-copy card has no source for "has the
target database applied this migration?", so `pendingMigrations` stays an engine input the panel
does not fill yet; the code↔live drift is the card's signal.

The browser-safe subpath forced one contract detail. `SecurityDiff`/`PolicyChange` carry a
structural `ReleasePolicySnapshot` declared in `release.ts` instead of `@facilis.dev/db`'s
`PolicySnapshot`: even an `import type` from the db pulled `@types/pg` (and through it
`@types/node`) into the Studio's browser program, where the Node and DOM `ReadableStream`
typings collide and the vendor kernel stops typechecking. The shapes are identical, so values from
`@facilis.dev/db` stay assignable. For the same reason the IDE's `@types/node` was aligned to the
workspace catalog (22.20.5) instead of its own 24.x pin: two Node typings produced two Vite
instances and broke `@facilis.dev/nitro`'s build. The engine file was split across
`release-preview`/`release-sql`/`release-classify`/`release-breaking`/`release-security`/
`release-api` to stay under 300 lines.

**Verification.** 92 `@facilis.dev/core` tests (31 new: splitter 3, classifier 20, engine 8; the
contract test still pins §7.7) and 562 IDE tests (19 API Flow + 20 Release Preview + the i18n
parity suite). The engine rejects/classifies statements, lifts drops to breaking on route
references, diffs policies and RLS, and reports pending/destructive/policy warnings. `pnpm lint`,
`pnpm typecheck` and `pnpm build` are green; the browser smoke opens the Release Preview, renders
the working-copy lens and switches it. The git-reading adapter has its own unit test against a
real temporary repository (HEAD, tag, old commit, missing ref, non-repo), so only the VFS fs
adapter itself is smoke-only. `pnpm ide:smoke` on a fresh profile opens the Release Preview after
the chat/write steps (so the project has git history), renders the content and switches to the
working-copy lens; the full run is green.
