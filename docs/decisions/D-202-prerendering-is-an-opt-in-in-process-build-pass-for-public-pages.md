# D-202 — Prerendering is an opt-in in-process build pass for public pages, hydrated not SSR
**Status:** accepted (2026-11-23)

**Context.** D-091 made prerendering a framework deliverable ("every route is prerendered to
HTML at build time from the same React tree and hydrated in the browser") but was executed in
the external `facilis-dev/facilis-site` repo: no prerender config, no `hydrateRoot`, no
initial-state mechanism landed here, and the spec defined no contract. Epic #79 contracts
opt-in, per-route prerendering + hydration for generated apps; the #80 spike
(`docs/findings/prerender-hydration.md`) proved all three candidate arms inside the
WebContainer on both template stacks (`vite@7.3.8` and `vite@8.3.5` + wasm rolldown), with
zero recoverable hydration errors, and recommended Arm C. The epic/child bodies say "D-195
(next free ID)"; that is stale — D-195..D-201 were taken meanwhile, so this decision takes the
next free ID, **D-202**, and every "D-195" reference in epic #79 and issues #81–#86 means this
entry.

**Decision.**

1. **Engine — Arm C, one framework-owned in-process pass.** A `closeBundle` step builds an
   SSR bundle, imports it in the same realm (the runner-"self" philosophy, D-024), renders the
   allowlist with `react-dom/static` `prerender` (waits for all data), fetching public data
   over loopback HTTP at build time, and writes per-route HTML + state island + sitemap + the
   shell fallback. No worker, no headless browser, no native binary, no third-party plugin.
   Arm A (Nitro `entry-server` + `prerender.routes`) is proven viable in-VM but is **not** the
   contract: a second Nitro build + worker per build, the heaviest memory, and the D-024
   worker-fragility history. Arm B (vite-prerender-plugin) is a reference only: its data island
   is unescaped `JSON.stringify` (XSS), link crawling is on by default, and the prerender
   script rides the client build. The engine ships once; the static path must not import
   Nitro, db or auth at runtime — it is consumed as a build-time-only entry (the exact
   package/entry layout is #82/#83's implementation choice under that constraint).
2. **Declaration surface — first-class, validated, per template kind.** Full-stack projects:
   a `prerender: { routes: string[], origin?: string }` section in `facilis.config.ts`
   (`z.strictObject`, default `{ routes: [] }` = off), cross-checked in
   `config-validation.ts`. The `nitro.prerender` passthrough (D-034) is rejected as the
   surface: no validation, no eligibility, and Nitro would prerender the empty SPA shell. The
   static template has no `facilis.config.ts`: it declares the same allowlist as a
   `prerender({ routes, origin? })` plugin option in `vite.config.ts`, from the build-time-only
   framework entry; D-168 is amended to allow that one build-time-only devDependency (runtime
   stays framework-free). The IDE page toggle (#84) writes the declaration through
   `kernel.writeFiles` (invariant 7), never OPFS directly.
3. **Eligibility — a fail-closed analyzer fact, page-level.** A declared path is eligible iff
   (a) it matches a param-free entry of the one route table (D-058/D-134) whose element is a
   page component — a redirect-only `Navigate` entry is not a page; (b) no session-dependent
   guard wraps it (`RequireAuth` or `PublicOnly`); (c) every `PageFact.calls` target has
   manifest `security: "public"` (`permission: []`, D-116) — zero calls is fine. Unknown
   security → ineligible, never guessed (D-092). Dynamic param routes are ineligible;
   enumerated instances are deferred (O-021). Ineligibility reasons are first-class facts:
   `private-api` (naming the offending route), `auth-guarded`, `unknown-security`,
   `dynamic-path`, `redirect`. A declared-but-ineligible route **fails the build** with a
   framework code naming route + reason — never a silent skip; the IDE shows the reason and
   disables the toggle. Zero execution: eligibility is static, rendering happens only in the
   build pass.
4. **Hydration contract.** One `<script type="application/json" id="prerender-data">` island
   per document: XSS-escaped JSON (`<`, `>`, `&`, U+2028/U+2029) of public API responses
   keyed by request path — never the session, never an identity. `main.tsx` mounts
   `hydrateRoot` (logging `onRecoverableError`) when prerendered markup + island are present,
   `createRoot` otherwise; a corrupt or absent island falls back to `createRoot` (fail-safe).
   `api()` answers a declared public GET from the island before any fetch
   (no refetch-before-hydrate); revalidation happens in effects after hydration.
   `SessionProvider` still loads `GET /api/auth/session` once at boot, client-side only —
   prerendered pages are anonymous by construction. `initTheme`/`initI18n` are SSR-safe: no
   `window`/`localStorage` during render; the server renders defaults and stored preferences
   apply in post-hydration effects, so the first client render matches the HTML. Plain JSON
   suffices; devalue/seroval only if richer values are ever needed.
5. **Serving and fallback.** Output is subfolder-index: `/about` → `dist/about/index.html`,
   `/` → `dist/index.html`. The SPA shell is always emitted as `dist/shell.html`; when `/`
   is not declared, `dist/index.html` is the shell. Dev: a `configureServer` middleware in
   `facilis()` serves the stored HTML for `GET` + `Accept: text/html` on declared routes and
   the shell otherwise; under the IDE preview prefix it rewrites root-relative hrefs to the
   serving base while the client router keeps `basename={appBasePath()}` (a server href that
   cannot match the client basename is a React #418 failure — spike gotcha 7). **No Service
   Worker change** (the D-132 patch stays untouched). `vite preview` falls back to
   `shell.html` for non-declared routes. Canonical paths are the declared paths verbatim (no
   trailing slash added); production hosting rewrites are out of contract.
6. **SEO deliverables.** Per-route title/meta/canonical via React 19 document-metadata
   hoisting. Canonical links and `sitemap.xml` (exactly the allowlist) are emitted only when
   `prerender.origin` is declared (a validated absolute origin); without it, title/meta still
   render and the sitemap is omitted — never a wrong canonical. Prerendered HTML is served to
   every client: no UA sniffing, no dynamic rendering.
7. **Boundaries.** `vite build` stays the only build command — run manifests unchanged.
   Prerender output is build output (`dist/`), never a release artifact: the DB-only release
   contract (D-158/D-159) and hosting stay out of scope. The pass runs with no session and no
   system identity; a 401/403/error data response fails the build — an error body is never
   written as a page. `defineAuthorizedHandler` and every SPEC §8 invariant are untouched;
   `permission: []` semantics are unchanged (D-116). The analyzer stays zero-execution
   (D-092). AI write scope is unchanged (rule 11, D-167): `facilis.config.ts` is writable in
   both profiles, `vite.config.ts` is `open`-profile only; the IDE toggle is a studio write,
   not an AI write. No manifest/OpenAPI change in this slice — render mode is derivable
   (declared ∧ eligible) and the graph consumes the analyzer facts directly.

**Rejected alternatives.** Full SSR of every route (auth-gated pages must stay client-rendered);
UA-sniffed dynamic rendering (Google de-recommends it; cloaking risk; social crawlers need real
HTML for everyone); headless-browser prerender (native binaries cannot run in the
WebContainer); a second router/framework (Vike, TanStack Start — violates D-058); Arm A as the
shipping contract (worker fragility history, heaviest build); Arm B shipped (XSS island,
crawling by default); `nitro.prerender` passthrough as the sole surface (no validation or
eligibility); runtime-only eligibility checks (the HTML would already be written); enumerated
dynamic paths now (a separate contract slice, O-021).

**Consequences.** Issues #82–#86 are triageable with no further contract decision. D-091 and
D-168 carry amendments; SPEC §4.2/§5.6/§5.11/§7.1/§8.2/§10.6/§13 + Appendices B/E,
docs/FRONTEND.md §11 and docs/DEV.md §6.2 follow. The in-VM build budget is a documented risk
(§13 row 13): guest memory is unobservable today, host RSS is the proxy, and the #85 smoke gate
carries a larger route fixture for the ~50-route scaling question. The spike
`spikes/prerender-hydration/` retires per D-006 once the implementation lands (findings in
code **and** spec); until then it stays the reference implementation for #83.

**Verification.** `docs/findings/prerender-hydration.md` (issue #80): 6/6 stack×arm builds
green on host and in-VM; hydration with zero recoverable errors; the auth-guarded route never
prerendered; no error body emitted; Arm C the lightest (host 244–762 ms, in-VM 1.0–1.8 s for a
3-route app). Docs-only change: the decision gate (`pnpm lint`) checks numbering, slug and
index.
