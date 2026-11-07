// The Facilis project template — the only kind of project this IDE creates (D-051).
//
// The generated project IS examples/todo-app (D-062): its client, server, schema, locales
// and configs are inlined as raw text at IDE build time (example-template.ts), so the
// starter app and the reference app cannot drift. This module assembles that source with
// the IDE-specific wrappers (project-files.ts) and the IDE overrides
// (template-overrides.ts), and carries the run manifest.

import type { ProjectManifest, ProjectTemplate } from "../vv/project-manifest";
import { exampleProjectFiles } from "./example-template";
import { projectFiles } from "./project-files";
import { templateOverrides } from "./template-overrides";

/**
 * The workspace-only @facilis packages, shipped as tarballs (O-006).
 *
 * They are inlined into the create request at create time (project-assets.ts) and declared
 * as file: dependencies in package.json, so the install never reaches the studio over HTTP
 * (D-032). The specs are written relative (portable) and made absolute by
 * scripts/vendor-paths.cjs before every install, because npm's own re-derivation of a
 * relative file: target is what breaks inside the VM.
 *
 * "ui" is absent: the v1 component kit was removed (D-096), and template v2 copies its
 * primitives into the project (src/components/ui) instead of shipping a package, so no
 * tarball is inlined and no file: dependency is declared.
 */
export const TEMPLATE_PACKAGES = ["analyze", "auth", "core", "db", "nitro", "time"] as const;

/** One binary file a template ships beside its sources (see project-assets.ts). */
export type TemplateAsset = { path: string; asset: string };

/** The run manifest plus the assets the IDE inlines into the create request. */
export type FacilisManifest = ProjectManifest & { assets: TemplateAsset[] };

/**
 * Build the template.
 *
 * `asset` is vendor-relative (the studio's own /vendor/ path) and resolved by the IDE
 * page itself — same origin, under the app's Vite base — then inlined as bytes into the
 * create request: no host alias, no VM networking, nothing for a guest package manager
 * to fetch.
 */
export function createFacilisTemplate(): ProjectTemplate {
  const assets: TemplateAsset[] = TEMPLATE_PACKAGES.map((name) => ({
    path: "vendor/facilis-" + name + "-0.0.0.tgz",
    asset: "vendor/facilis/facilis-" + name + "-0.0.0.tgz",
  }));
  // npm is the project's package manager: the one the IDE vendors and keeps aligned
  // with the VM's Node (D-032). The first `--` is npm's, so `--configLoader native`
  // reaches vite — its config bundler cannot run in the WebContainer.
  const manifest: FacilisManifest = {
    id: "facilis",
    name: "Facilis",
    entry: "src/app.tsx",
    hmr: true,
    reload: false,
    // The @facilis/* deps resolve from the vendored tarballs. npm re-derives the target of
    // a RELATIVE file: spec and, inside the VM, that derivation was measured producing
    // /user/projects/... instead of /home/user/projects/... (install dies with ENOENT on a
    // tarball that exists). scripts/vendor-paths.cjs pins them to absolute paths first —
    // see project-files.ts.
    install: "node scripts/vendor-paths.cjs && npm install",
    // In the VM the in-process runner makes Nitro own the listener and front Vite, so
    // the single origin the preview targets is the nitro dev-server port, not 5173.
    port: 3000,
    dev: "npm run dev -- --configLoader native",
    assets,
  };
  return {
    manifest,
    // Example first; the wrappers and overrides replace only the files the IDE owns.
    files: {
      ...exampleProjectFiles(),
      ...projectFiles(),
      ...templateOverrides(),
    },
  };
}
