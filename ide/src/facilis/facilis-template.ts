// The Facilis probe template.
//
// A minimal but real Facilis project (Vite 8 + Nitro v3 owned by facilis() + PGlite)
// the IDE scaffolds into the WebContainer, where a real npm install and vite dev
// prove that facilis() (which mounts Nitro) + PGlite boot and serve (Phase 0 proof spike).
//
// The payload lives in sibling modules so every file stays under the 300-line
// limit; this file only assembles it and carries the picker manifest.

import type { TemplateDef, TemplateManifest } from "../vv/templates";
import { clientFiles } from "./client-files";
import { dbFiles } from "./db-files";
import { projectFiles } from "./project-files";
import { serverAuthFiles } from "./server-auth-files";
import { serverFiles } from "./server-files";

/**
 * The workspace-only @facilis packages, shipped as tarballs (O-006).
 *
 * They are copied into the project at create time and declared as file: dependencies
 * in package.json, so the install never reaches the studio over HTTP (D-032). The specs
 * are written relative (portable) and made absolute by scripts/vendor-paths.cjs before
 * every install, because npm's own re-derivation of a relative file: target is what
 * breaks inside the VM.
 */
const PACKAGES = ["auth", "core", "db", "nitro"] as const;

/** One binary file a template ships beside its sources (see the kernel worker). */
export type TemplateAsset = { path: string; asset: string };

/** The shared manifest plus the assets the kernel fetches before it writes the tree. */
export type FacilisManifest = TemplateManifest & { assets: TemplateAsset[] };

/**
 * Build the template.
 *
 * `asset` is vendor-relative (the studio's own /vendor/ path) and resolved by the
 * kernel worker, which runs in the page and is same-origin — no host alias, no VM
 * networking, nothing for a guest package manager to fetch.
 */
export function createFacilisTemplate(): TemplateDef {
  const assets: TemplateAsset[] = PACKAGES.map((name) => ({
    path: "vendor/facilis-" + name + "-0.0.0.tgz",
    asset: "vendor/facilis/facilis-" + name + "-0.0.0.tgz",
  }));
  // npm is the project's package manager: the one the IDE vendors and keeps aligned
  // with the VM's Node (D-032). The first `--` is npm's, so `--configLoader native`
  // reaches vite — its config bundler cannot run in the WebContainer.
  const manifest: FacilisManifest = {
    id: "facilis",
    framework: "facilis",
    icon: "fullstack",
    category: "Fullstack",
    name: "Facilis",
    language: "TypeScript",
    description: "Facilis + Nitro + PGlite + React — the framework's own probe app",
    openPath: "/",
    entry: "src/App.tsx",
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
    files: {
      ...projectFiles(),
      ...dbFiles,
      ...serverFiles,
      ...serverAuthFiles,
      ...clientFiles,
    },
  };
}
