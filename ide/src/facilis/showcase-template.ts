// The static (frontend-only) showcase template (D-168).
//
// The generated project IS examples/showcase-app: React 19 + Vite 8 + Tailwind v4 with no
// server, database or facilis.config.ts. The example is inlined as raw text at IDE build
// time (Vite import.meta.glob), so the showcase the IDE scaffolds and the example app
// cannot drift; this module adds only its manifest and the static wrappers.

import type { ProjectTemplate } from "../vv/project-manifest";
import { exampleSources } from "./example-sources";
import { staticPackageJson, SHOWCASE_README, STATIC_TSCONFIG_INCLUDE } from "./static-files";
import { assembleTemplate } from "./template-files";
import type { FacilisManifest } from "./template-types";

const EXAMPLE_DIR = "examples/showcase-app/";

const rawSources = import.meta.glob<string>(
  [
    "../../../examples/showcase-app/src/**/*.{ts,tsx,css}",
    "!../../../examples/showcase-app/src/**/*.test.*",
    "../../../examples/showcase-app/locales/*.json",
    "../../../examples/showcase-app/index.html",
    "../../../examples/showcase-app/.gitignore",
    "../../../examples/showcase-app/vite.config.ts",
    "../../../examples/showcase-app/package.json",
  ],
  { query: "?raw", import: "default", eager: true },
);

/**
 * Build the static showcase template.
 *
 * It ships sources and the example's own package.json: there is no Nitro and no
 * @facilis.dev dependency, and the only IDE additions are the same wrapper files every
 * project gets (.npmrc, tsconfig, README, scripts/check-pm.mjs and the admission marker).
 */
export function createShowcaseTemplate(): ProjectTemplate {
  // The manifest's port is the Vite dev-server port the preview points at; the example's
  // vite.config sets it to 3000. --configLoader native keeps Vite's config bundler out of
  // the WebContainer (same reason as the full-stack template).
  const manifest: FacilisManifest = {
    id: "facilis-showcase",
    name: "Facilis showcase",
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
    example: exampleSources(rawSources, EXAMPLE_DIR),
    wrappers: {
      packageJson: staticPackageJson,
      readme: SHOWCASE_README,
      tsconfigInclude: STATIC_TSCONFIG_INCLUDE,
    },
  });
}
