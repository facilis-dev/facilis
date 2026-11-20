# D-051 — The IDE is Facilis-only: one creation path, no template catalog
**Status:** accepted (2026-10-31)

Phase 2 inherited the whole Vivari template catalog — 55 templates across 9 categories, ~11.4k
lines of payloads plus a brand-icon module — and Home offered "Start from blank", "Start from
template" and the import path. The product direction is Facilis-only: a generated project is
Nitro + PGlite + React following `facilis.config.ts`, and every other template (and the blank
project) was dead product surface that also kept a ~99 KB lazy chunk and its transform cost in
the IDE.

**Decision.** Remove `src/vv/templates.ts`, `src/vv/templates-lazy.ts`, `templateIcons.tsx` and
the brand SVGs only they used. The run manifest moves to `src/vv/project-manifest.ts` — the
kernel contract only (id, name, port, entry, install, dev, hmr/reload and the preview flags);
`src/facilis/facilis-template.ts` is the one template, loaded lazily by
`src/facilis/template-loader.ts`. Home has one creation card and one dialog (name, directory,
run-or-not) calling `IdeController.createProject`. `synthesizeManifest` for
imported/shared projects keeps only the runtime fields it actually sets.

A project created before this decision with one of the removed templates still opens, but with
no known run manifest: Run drops into a shell in the project instead of starting the wrong dev
command. The file-length baseline and `check-ide-theme.mjs` lose their template entries.

**Consequences:** smaller entry/lazy chunks, one obvious creation flow for users and for the
AI, and no product surface the framework cannot support. The trade-off is that importing an
existing non-Facilis project (folder/GitHub/npm) still works as an editor, but the IDE no
longer scaffolds one.

**Verification:** `pnpm --filter @facilis.dev/ide typecheck|test` (the asset tests build the Facilis
template directly); `pnpm lint` (the file-length ratchet and theme check no longer exempt the
deleted files); `pnpm ide:smoke` drives the new dialog and the framework probes.
