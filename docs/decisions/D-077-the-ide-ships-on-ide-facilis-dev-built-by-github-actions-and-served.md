# D-077 — The IDE ships on `ide.facilis.dev`, built by GitHub Actions and served by Cloudflare Pages
**Status:** accepted (2026-11-01)

D-020 reserved `facilis.dev` as the project home (site + docs); the IDE is not the landing
page, so it must not own the apex. It gets its own origin, `ide.facilis.dev`, which also keeps
the preview Service Worker's root-scope claims confined to the app, and leaves the apex free
for the presentation site.

**Decision.** Production is a Cloudflare **Pages** project (`facilis-ide`) with
`ide.facilis.dev` as its custom domain. `.github/workflows/deploy-ide.yml` runs on every push
to `main` that touches the IDE inputs: it checks out the submodule, installs, rebuilds the
four gitignored build artifacts (`pnpm ide:wasm`, `pnpm ide:assets`, `pnpm ide:facilis-deps`),
runs the production Vite build and uploads the finished `ide/dist` with
`wrangler pages deploy` (pinned wrangler version in the workflow). Cloudflare's Git
integration is deliberately not used: the kernel Wasm needs a Rust toolchain plus a ~100 s
cargo build that Pages' builder cannot cache, while GitHub Actions caches it by the pinned
submodule commit — so the pipeline stays fast and deploys exactly the tree the repo builds.
Nothing has to be run locally.

The host configuration is in the repo, not the dashboard: `ide/public/_headers` (shipped from
the build) sets COOP/COEP on every response — the kernel needs `SharedArrayBuffer` — keeps
`/sw.js` at root scope with `Service-Worker-Allowed: /`, marks the content-hashed `assets/`
immutable and revalidates the unhashed `vendor/` and DevTools trees. The workflow verifies the
deployed production URL returns those headers, so configuration drift fails the deploy.

**Consequences.** The apex stays free for the presentation site (D-020); the IDE's canonical
link points at its own origin (D-075's brand strings and canonical-domain rule are unchanged —
the product is still called facilis.dev). Deploying is a push to `main`; `workflow_dispatch`
covers a manual re-deploy. The operator supplies the repository secrets
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` (token scoped to `Cloudflare Pages: Edit`,
no zone-wide rights): the workflow creates the Pages project itself, idempotently, on the first
run (documented in `docs/DEV.md` §9). The `ide.facilis.dev` custom domain is a one-time
`Custom domains` click in the project; the workflow would attach it too, but only for a token
that carries the zone permissions. Per-PR preview deployments are not enabled yet; a
`*.pages.dev` preview URL is a later change to the same workflow.
