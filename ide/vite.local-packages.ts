// Dev-only server for the workspace framework packages (issue #41, D-196).
//
// pnpm ide:dev exposes the built packages from the IDE's own origin so a generated project
// can install them with file: deps instead of npm, exercising a packages/** change in the
// WebContainer without publishing. The route exists only in configureServer: a production
// build never registers it, so /__facilis/dev/packages/* is a 404 there (security invariant
// 6). The browser side (src/facilis/local-packages.ts) fetches the index and copies the
// files into the project VFS at create time.
//
// The packages must be built first (dist/ is what the native ESM loader imports under
// node_modules); scripts/dev/smoke-ide.mjs and docs/DEV.md carry that pre-step.

import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  LOCAL_PACKAGES_ROUTE,
  rewriteLocalManifest,
  type LocalPackageEntry,
  type LocalPackageIndex,
} from "./src/facilis/local-packages.ts";

const MOUNT = "/" + LOCAL_PACKAGES_ROUTE;
const SCOPE = "@facilis.dev/";

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".json": "application/json",
  ".ts": "text/plain",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".md": "text/markdown",
};

interface LocalPackage {
  name: string;
  bare: string;
  dir: string;
  manifest: Record<string, unknown>;
}

/** Every non-private @facilis.dev package, the same set scripts/publish-packages.mjs stages. */
function discoverPackages(repoRoot: string): LocalPackage[] {
  const packagesDir = path.join(repoRoot, "packages");
  const out: LocalPackage[] = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    const manifestPath = path.join(dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const name = manifest.name;
    if (typeof name !== "string" || !name.startsWith(SCOPE) || manifest.private) continue;
    out.push({ name, bare: name.slice(SCOPE.length), dir, manifest });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Package-relative file paths served for a package: the manifest plus its built dist/. */
function packageFiles(pkg: LocalPackage): string[] {
  const files = ["package.json"];
  const dist = path.join(pkg.dir, "dist");
  if (!fs.existsSync(dist)) {
    throw new Error(`facilis: ${pkg.name} has no dist/ — build the packages first (pnpm build)`);
  }
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dist, rel), { withFileTypes: true })) {
      const child = rel === "" ? entry.name : rel + "/" + entry.name;
      if (entry.isDirectory()) walk(child);
      else files.push("dist/" + child);
    }
  };
  walk("");
  for (const extra of ["README.md", "LICENSE"]) {
    if (fs.existsSync(path.join(pkg.dir, extra))) files.push(extra);
  }
  return files;
}

function buildIndex(packages: LocalPackage[]): LocalPackageIndex {
  const entries: LocalPackageEntry[] = packages.map((pkg) => ({
    name: pkg.name,
    bare: pkg.bare,
    files: packageFiles(pkg),
  }));
  return { packages: entries };
}

/**
 * Same-origin guard mirroring packages/nitro's isOriginAllowed (D-146): a same-origin GET
 * omits Origin, an explicit "null" is rejected, and a cross-origin caller must match the
 * request host. The dev host (facilis.home) is non-loopback, so the host-equality branch is
 * what allows the IDE page while blocking other origins.
 */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (origin === "null") return false;
  const host = req.headers.host ?? "";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: Buffer | string, type: string): void {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

/** Serve one package file; package.json is the rewritten local-install manifest. */
function serveFile(
  pkg: LocalPackage,
  rel: string,
  internalNames: ReadonlySet<string>,
  res: ServerResponse,
): void {
  if (rel === "package.json") {
    const rewritten = rewriteLocalManifest(pkg.manifest, internalNames);
    send(res, 200, JSON.stringify(rewritten, null, 2) + "\n", MIME[".json"]);
    return;
  }
  const abs = path.resolve(pkg.dir, rel);
  // Traversal guard: the resolved path must stay inside this package's directory.
  if (abs !== pkg.dir && !abs.startsWith(pkg.dir + path.sep)) {
    send(res, 403, "forbidden", "text/plain");
    return;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    send(res, 404, "not found", "text/plain");
    return;
  }
  const type = MIME[path.extname(abs)] ?? "application/octet-stream";
  send(res, 200, fs.readFileSync(abs), type);
}

/**
 * The dev-only local-packages route. Registered only for vite dev (see vite.config.ts);
 * a production build has no such middleware and the path falls through to the SPA 404.
 */
export function localPackagesPlugin(repoRoot: string): Plugin {
  return {
    name: "facilis-local-packages",
    apply: "serve",
    configureServer(server) {
      const packages = discoverPackages(repoRoot);
      const internalNames = new Set(packages.map((pkg) => pkg.name));
      const byBare = new Map(packages.map((pkg) => [pkg.bare, pkg]));
      server.middlewares.use(MOUNT, (req, res) => {
        if (!originAllowed(req)) {
          send(res, 403, "forbidden origin", "text/plain");
          return;
        }
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        if (rel === "index.json") {
          try {
            send(res, 200, JSON.stringify(buildIndex(packages), null, 2) + "\n", MIME[".json"]);
          } catch (error) {
            send(res, 500, String(error instanceof Error ? error.message : error), "text/plain");
          }
          return;
        }
        const slash = rel.indexOf("/");
        const bare = slash === -1 ? rel : rel.slice(0, slash);
        const file = slash === -1 ? "" : rel.slice(slash + 1);
        const pkg = byBare.get(bare);
        if (pkg === undefined || file === "") {
          send(res, 404, "not found", "text/plain");
          return;
        }
        serveFile(pkg, file, internalNames, res);
      });
    },
  };
}
