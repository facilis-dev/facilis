# D-091 — facilis.dev is a static site created inside the Studio, and the catalog is its own data
**Status:** accepted (2026-11-03)

The website brief (`docs/WEBSITE.md`) proposed Astro + Starlight and explicitly deferred
dogfooding. Two things changed that. D-090 made a generated app standard React/Tailwind source,
which is what a copy-in section catalog needs; and the product's best proof is its own workflow —
creating the site in the Studio is a real test of creation, editing, AI, preview and export, and it
leaves a journal of every step that a launch page can publish. The cost is explicit: a
client-rendered marketing page is slower and less crawlable than static HTML, so the site cannot
argue "day one is a link" from a slow page.

**Decision.** `facilis.dev` is a **statically exported** app created and edited inside the Studio.

- **Location.** The project is created by Studio "New project" (template v2, D-090), project
  name `facilis-dev`, and exported with "Export Project as Zip"; it lives in its own repository,
  `facilis-dev/facilis-site` (see the amendment below), and every edit made to the export is
  itemised in that repo's `BUILD-JOURNAL.md`.
- **No server in production.** Every route is prerendered to HTML at build time from the same React
  tree and hydrated in the browser. Nitro remains part of the project for the in-VM dev server and
  is not deployed: the site has no API, so it needs no database, no auth and no runtime.
- **The catalog is the site's own data.** Section sources live under `catalog/sections/<slug>/` in
  the site repository
  (files + `section.json` reusing `BlockManifest` from `@facilis.dev/blocks`, plus the copy-in
  facts: dependency list, insertion point, migration, screenshot); a build step emits versioned,
  content-hashed, CORS-open JSON under `/catalog/`. The site renders those files and any client —
  including the Studio later — reads the same ones. No CMS, no database, no API.
- **Origin.** The IDE stays at `ide.facilis.dev`. Moving it would strand every origin-scoped OPFS
  project and service worker; `/try` on facilis.dev is therefore a **redirect**, not an iframe,
  because `COOP`/`COEP` are not inherited by frames and facilis.dev has no WebContainer to justify
  them.
- **Copy and launch surface.** `docs/WEBSITE.md` v3 stays the copy source. The product is called
  **IDE**, the site `facilis.dev` (closes W-12); launch is EN only, with no waitlist ("in attesa")
  and no analytics.
- **Deploy stays with the maintainer.** The repo produces the artifact and the command; no deploy
  workflow is added for the site until it is real.
- **The journal is a deliverable.** The site repo's `BUILD-JOURNAL.md` records steps, timings,
  AI prompts and every gap dogfooding exposes; it is the source of the site's "how this was built"
  page.

**Amendment (2026-11-03) — the site lives in its own repository.** It first landed as
`sites/facilis-dev`, a pnpm-workspace member of this repo. Keeping it there coupled three things
that should move independently: the site's release cadence, the framework's gates (a doc edit in
the IDE repo would rebuild the site), and the generated-project boundary the site is supposed to
prove (a workspace member silently resolves `@facilis.dev/*` from source instead of from the tarballs
a user gets). The site now lives in **`facilis-dev/facilis-site`**: the unmodified Studio export,
its journal, and a `tools/create-in-studio.mjs` provenance harness; it commits the `vendor/`
tarballs so it stays a self-contained generated project and needs no workspace. The boundary is
**re-export, not shared workspace**: a framework change the site needs arrives as a new export,
and the diff is applied in the site repo. Two deviations from the export are documented there: the
tarball specifiers are relative, and the two WASM-only devDependencies are removed because npm
refuses them outside the VM (`EBADPLATFORM`; journal G4 — candidate fix: declare them
`optionalDependencies`). Nothing in the IDE repo depends on the site repo.

**Rejected alternatives.** *Astro + Starlight now*: it would not exercise the product, and the
catalog would exist twice (an Astro rendering of sections and the copy-in source). *One
repository for IDE and site* (the first version of this decision, reversed the same day — see the
amendment): brand and CI would not drift, but the site's release would be tied to the framework's
and the generated-project boundary would be invisible. *A catalog API or a CMS*: the site has no other runtime, and the static JSON is the
same artifact the Studio will consume. *Moving the IDE to a new subdomain*: origin-scoped project
storage makes it a migration, not a rename. *An iframe for `/try`*: COOP/COEP.

**Consequences.** The site's page weight and SEO become framework deliverables (prerendering is now
a build step the template needs), and "this site is a Facilis app" becomes a checkable claim. The
catalog format becomes a public contract, so it is versioned from its first commit. The marketing
site no longer has an independent stack to fall back on; if it cannot reach acceptable LCP, the
fallback is a static shell plus the app for the interactive parts, not a rewrite in another
framework.

**Verification.** Step 1 (evidence in `spikes/facilis-site/` and in the site repo's
`docs/evidence/`): the real Studio created the project and exported it (242 276-byte zip, 75
files, create → preview 129.5 s, kernel online 1.6 s); in the site repo, `npm install` and
`npm run build` pass on the host (`vite build` emits the Nitro server output that production will
not deploy). Dogfooding exposed four gaps recorded in the journal: exported dependencies are
absolute VM `file:` paths (G1), the project is npm-only by a preinstall guard (G2), the only way
back to a repository is the zip export (G3), and the generated devDependencies are not portable —
the two WASM-only bindings make a host `npm install` fail with `EBADPLATFORM` (G4).
