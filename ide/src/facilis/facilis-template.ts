// The full-stack (Nitro + PGlite + React) project template — the default template
// (D-051, D-168).
//
// The generated project IS examples/todo-app (D-062): its client, server, schema, locales
// and configs are inlined as raw text at IDE build time (example-template.ts), so the
// starter app and the reference app cannot drift. template-files.ts assembles that source
// with the full-stack wrappers (fullstack-files.ts) and the IDE overrides
// (template-overrides.ts), and carries the run manifest.

import type { ProjectTemplate } from "../vv/project-manifest";
import { todoExampleSources } from "./example-template";
import {
  FULLSTACK_README,
  FULLSTACK_TSCONFIG_INCLUDE,
  fullstackPackageJson,
} from "./fullstack-files";
import { assembleTemplate } from "./template-files";
import { templateOverrides } from "./template-overrides";
import type { FacilisManifest } from "./template-types";

// Re-exported from here because the asset pipeline and its tests import the manifest
// types next to the factory they build.
export type { FacilisManifest, TemplateAsset } from "./template-types";

/**
 * The @facilis.dev packages a generated project declares (D-166).
 *
 * They install from the public npm registry at the exact version this build pins
 * (frameworkPackagesVersion) — ordinary published dependencies (D-164), not inlined
 * tarballs.
 *
 * "ui" is absent: the v1 component kit was removed (D-096), and template v2 copies its
 * primitives into the project (src/components/ui) instead of shipping a package.
 */
export const TEMPLATE_PACKAGES = [
  "analyze",
  "auth",
  "core",
  "db",
  "nitro",
  "storage",
  "time",
] as const;

/**
 * Build the full-stack template.
 *
 * The template ships sources only: every @facilis.dev/* package installs from npm at the
 * exact version its package.json pins (fullstack-files.ts), so the create request carries
 * no binary assets. The manifest keeps the asset list because the create pipeline reads it
 * (project-assets.ts); an empty list makes that step a no-op.
 */
export function createFacilisTemplate(): ProjectTemplate {
  // npm is the project's package manager: the one the IDE vendors and keeps aligned
  // with the VM's Node (D-032). The first `--` is npm's, so `--configLoader native`
  // reaches vite — its config bundler cannot run in the WebContainer.
  const manifest: FacilisManifest = {
    id: "facilis",
    name: "Facilis",
    entry: "src/app.tsx",
    hmr: true,
    reload: false,
    // The @facilis.dev/* deps are ordinary registry dependencies pinned to one exact
    // version (see fullstack-files.ts), so the install needs no pre-step.
    install: "npm install",
    // In the VM the in-process runner makes Nitro own the listener and front Vite, so
    // the single origin the preview targets is the nitro dev-server port, not 5173.
    port: 3000,
    dev: "npm run dev -- --configLoader native",
    assets: [],
  };
  return assembleTemplate({
    manifest,
    // Example first; the wrappers and overrides replace only the files the IDE owns.
    example: todoExampleSources(),
    wrappers: {
      packageJson: fullstackPackageJson,
      readme: FULLSTACK_README,
      tsconfigInclude: FULLSTACK_TSCONFIG_INCLUDE,
    },
    overrides: templateOverrides(),
  });
}
