// Dev-only local workspace packages for generated projects (issue #41, D-196).
//
// A dev build can install the @facilis.dev/* packages from the IDE's own origin instead of
// npm, so a change under packages/** is exercised in the WebContainer without publishing
// (D-166's release path stays the production default). The IDE dev server serves each
// package's dist/ + a rewritten package.json (internal deps become file:../<sibling>); at
// create time the IDE copies those files into the project VFS under vendor/facilis/<pkg>/
// and the template pins "@facilis.dev/<name>": "file:./vendor/facilis/<name>".
//
// This module is browser-safe and pure (no node:fs): the dev-server plugin
// (ide/vite.local-packages.ts) imports the manifest rewrite from here, and the create
// pipeline imports the fetch/copy helpers. A production build compiles localPackagesEnabled
// to false, so every helper below is dead code there and the route is never registered.

/** Compiled in by ide/vite.config.ts: true only in a dev build with the path enabled. */
declare const __FACILIS_LOCAL_PACKAGES__: boolean | undefined;

/**
 * Whether this build installs framework packages from the IDE origin (dev only).
 *
 * FACILIS_IDE_LOCAL_PACKAGES=0 turns it off even in dev, to test a pinned npm release.
 * An unbundled import (tests) falls back to false, the production behaviour.
 */
export const localPackagesEnabled: boolean =
  typeof __FACILIS_LOCAL_PACKAGES__ !== "undefined" ? __FACILIS_LOCAL_PACKAGES__ : false;

/** The dev-server route prefix that serves the workspace packages (no leading slash). */
export const LOCAL_PACKAGES_ROUTE = "__facilis/dev/packages";

/** The project-relative directory a local package is copied into. */
export function localPackageDir(name: string): string {
  return "vendor/facilis/" + name.replace("@facilis.dev/", "");
}

/** The file: dependency spec a generated project pins for a local package. */
export function localPackageSpec(name: string): string {
  return "file:./" + localPackageDir(name);
}

/**
 * The generated project's postinstall script for the dev local path (issue #41, D-196).
 *
 * npm always installs a file: directory dep as a symlink, and the in-VM rm -rf cannot delete
 * a project whose node_modules symlinks point back into the project tree (it fails ENOTDIR on
 * the @facilis.dev/* -> vendor/facilis/* directory links). This replaces each framework
 * symlink with a real copy, so the installed tree deletes exactly like a registry install.
 * It runs after npm install has linked the packages; a release build never ships it.
 */
export const LOCAL_PACKAGES_POSTINSTALL = `// Dev local packages (D-196): replace the framework file: symlinks with real copies so
// the project tree deletes cleanly (the in-VM rm -rf fails ENOTDIR on symlinks that point
// back into the project). Runs as postinstall, after npm has linked the packages.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const vendor = path.join(root, "vendor", "facilis");
const scope = path.join(root, "node_modules", "@facilis.dev");
if (!fs.existsSync(vendor)) process.exit(0);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

for (const entry of fs.readdirSync(vendor, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dest = path.join(scope, entry.name);
  const stat = fs.lstatSync(dest, { throwIfNoEntry: false });
  // Unlink a symlink directly: a recursive rm would follow it into the vendor tree.
  if (stat?.isSymbolicLink()) fs.unlinkSync(dest);
  else if (stat) fs.rmSync(dest, { recursive: true, force: true });
  copyDir(path.join(vendor, entry.name), dest);
}
`;

/** One package in the dev index: its scoped name and the files served for it. */
export interface LocalPackageEntry {
  name: string;
  /** Path segment under the route and under vendor/facilis/ (the bare package name). */
  bare: string;
  /** Package-relative file paths, e.g. "package.json" and "dist/index.js". */
  files: string[];
}

/** The dev index served at /__facilis/dev/packages/index.json. */
export interface LocalPackageIndex {
  packages: LocalPackageEntry[];
}

type Manifest = {
  name?: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
};

/** Rewrite a ./src/*.ts entry to the ./dist/*.js the native ESM loader can import.
 *  A declaration file keeps its .d.ts extension (only runtime .ts becomes .js). */
function distEntry(value: string): string {
  const moved = value.replace(/^\.\/src\//, "./dist/");
  return moved.endsWith(".d.ts") ? moved : moved.replace(/\.ts$/, ".js");
}

function distExports(exports: unknown): unknown {
  if (typeof exports === "string") return distEntry(exports);
  if (exports && typeof exports === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(exports as Record<string, unknown>)) {
      out[key] = distExports(value);
    }
    return out;
  }
  return exports;
}

/**
 * Rewrite a workspace manifest into the local-install manifest the dev server serves.
 *
 * Mirrors scripts/publish-packages.mjs's staging (exports resolve to dist/*.js because the
 * generated project's Vite config loads under node_modules with --configLoader native), but
 * internal @facilis.dev/* deps become file:../<sibling> instead of a registry version: the
 * sibling is copied next to this package under vendor/facilis/, so npm resolves it locally.
 * Pure: the caller supplies the manifest and the set of internal package names.
 */
export function rewriteLocalManifest(
  manifest: Manifest,
  internalNames: ReadonlySet<string>,
): Manifest {
  const out: Manifest = { ...manifest };
  if (typeof out.main === "string") out.main = distEntry(out.main);
  if (typeof out.module === "string") out.module = distEntry(out.module);
  if (typeof out.types === "string") out.types = distEntry(out.types);
  if (out.exports !== undefined) out.exports = distExports(out.exports);
  if (out.dependencies) {
    const deps: Record<string, string> = {};
    for (const [name, spec] of Object.entries(out.dependencies)) {
      deps[name] = internalNames.has(name) ? "file:../" + name.replace("@facilis.dev/", "") : spec;
    }
    out.dependencies = deps;
  }
  // A local install needs neither the workspace's dev tooling nor its scripts.
  delete out.devDependencies;
  delete out.scripts;
  return out;
}

/**
 * Fetch every local package's files from the dev origin into a create-project file map.
 *
 * Each file lands at vendor/facilis/<bare>/<file>, the path the template's file: spec names.
 * The bytes go through the create payload (kernel.writeFiles), never OPFS directly. A
 * non-OK or HTML response is a missing dev route, not a package: fail loudly rather than
 * write the SPA fallback into the project.
 */
export async function fetchLocalPackageFiles(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, Uint8Array>> {
  const root = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const indexResponse = await fetchImpl(root + "index.json");
  if (!indexResponse.ok) {
    throw new Error(`facilis: local packages index not served (HTTP ${indexResponse.status})`);
  }
  const index = (await indexResponse.json()) as LocalPackageIndex;
  const payload: Record<string, Uint8Array> = {};
  for (const entry of index.packages) {
    for (const file of entry.files) {
      const response = await fetchImpl(root + entry.bare + "/" + file);
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || type.includes("text/html")) {
        throw new Error(
          `facilis: local package file ${entry.bare}/${file} not served (HTTP ${response.status})`,
        );
      }
      payload[localPackageDir(entry.name) + "/" + file] = new Uint8Array(
        await response.arrayBuffer(),
      );
    }
  }
  return payload;
}
