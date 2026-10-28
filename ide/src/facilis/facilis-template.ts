// The Facilis probe template.
//
// A minimal but real Facilis project (Vite 8 + Nitro v3 as a Vite plugin + PGlite)
// the IDE scaffolds into the WebContainer, where a real npm install and vite dev
// prove that facilis() + nitro() + PGlite boot and serve (Phase 0 proof spike).
//
// The payload lives in sibling modules so every file stays under the 300-line
// limit; this file only assembles it and carries the picker manifest.

import type { TemplateDef } from "../vv/templates";
import { clientFiles } from "./client-files";
import { dbFiles } from "./db-files";
import { projectFiles } from "./project-files";
import { serverFiles } from "./server-files";

/**
 * The origin the in-VM npm uses to fetch the tarballs.
 *
 * It cannot be the studio origin verbatim: inside the WebContainer the kernel's virtual
 * network owns loopback, so http://127.0.0.1:<port> resolves to the VM itself and npm gets
 * ECONNREFUSED. The kernel's documented host alias (host.vivari.internal, see the fetcher
 * worker) is rewritten, in the browser page, to the studio's own hostname with the scheme and
 * port preserved — i.e. a same-origin request that survives the VM boundary. Keep the scheme
 * and port so a deployed (https, no port) studio works unchanged.
 */
export function vendorOrigin(origin: string): string {
  const url = new URL(origin);
  return url.protocol + "//host.vivari.internal" + (url.port === "" ? "" : ":" + url.port);
}

/**
 * Build the template for a given IDE origin.
 *
 * Interim delivery until @facilis/* is published (O-006): the generated
 * project's package.json points at the host-alias origin + "/vendor/facilis/facilis-<pkg>-0.0.0.tgz"
 * tarballs the IDE serves from its own public directory, so the in-VM npm install
 * never asks the registry for a workspace-only package.
 */
export function createFacilisTemplate(origin: string): TemplateDef {
  const base = vendorOrigin(origin).replace(/\/+$/, "");
  return {
    manifest: {
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
      install: "pnpm install",
      // In the VM the in-process runner makes Nitro own the listener and front Vite, so
      // the single origin the preview targets is the nitro dev-server port, not 5173.
      port: 3000,
      dev: "pnpm run dev --configLoader native",
    },
    files: {
      ...projectFiles(base),
      ...dbFiles,
      ...serverFiles,
      ...clientFiles,
    },
  };
}
