// The documentation-site template (D-168, issue #163).
//
// The generated project IS examples/docs-app: React 19 + Vite + Tailwind v4 with a
// Markdown/MDX content pipeline and no server, database or facilis.config.ts. The example
// is inlined as raw text at IDE build time (Vite import.meta.glob), so the docs site the
// IDE scaffolds and the example app cannot drift; this module adds only its manifest and
// the static wrappers. Content files (.md/.mdx) are part of the example sources: they are
// the pages, so the glob carries them like any other source file.

import type { ProjectTemplate } from "../vv/project-manifest";
import { exampleSources } from "./example-sources";
import { staticPackageJson, DOCS_README, STATIC_TSCONFIG_INCLUDE } from "./static-files";
import { assembleTemplate } from "./template-files";
import type { FacilisManifest } from "./template-types";

const EXAMPLE_DIR = "examples/docs-app/";

const rawSources = import.meta.glob<string>(
  [
    "../../../examples/docs-app/src/**/*.{ts,tsx,css}",
    "!../../../examples/docs-app/src/**/*.test.*",
    "../../../examples/docs-app/src/content/docs/**/*.md",
    "../../../examples/docs-app/src/content/docs/**/*.mdx",
    "../../../examples/docs-app/locales/*.json",
    "../../../examples/docs-app/index.html",
    "../../../examples/docs-app/.gitignore",
    "../../../examples/docs-app/vite.config.ts",
    "../../../examples/docs-app/package.json",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** The example's sources: every file, and the package.json the generated one is built from. */
export function docsExampleSources() {
  return exampleSources(rawSources, EXAMPLE_DIR);
}

/**
 * Build the documentation-site template.
 *
 * It ships sources and the example's own package.json: there is no Nitro and no
 * @facilis.dev runtime dependency — only the build-time-only prerender plugin entry
 * (D-202/D-168 amendment) — and the only IDE additions are the same wrapper files every
 * project gets (.npmrc, tsconfig, README, scripts/check-pm.mjs and the admission marker).
 */
export function createDocsTemplate(): ProjectTemplate {
  // The manifest's port is the Vite dev-server port the preview points at; the example's
  // vite.config sets it to 3000. --configLoader native keeps Vite's config bundler out of
  // the WebContainer (same reason as the full-stack template).
  const manifest: FacilisManifest = {
    id: "facilis-docs",
    name: "Facilis docs",
    entry: "src/app.tsx",
    hmr: true,
    reload: false,
    install: "npm install",
    port: 3000,
    dev: "npm run dev -- --configLoader native",
    assets: [],
  };
  return assembleTemplate({
    manifest,
    example: docsExampleSources(),
    wrappers: {
      packageJson: staticPackageJson,
      readme: DOCS_README,
      tsconfigInclude: STATIC_TSCONFIG_INCLUDE,
    },
  });
}
