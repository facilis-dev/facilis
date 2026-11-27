/**
 * The mount-time half of D-226 (decision 4): only declared project files reach Nitro.
 *
 * The analyzer decides what is declared; this module removes everything else from the lists
 * Nitro will turn into routes, middleware and plugins. An undeclared route is therefore not
 * merely reported: it cannot be mounted, so the request falls through to Nitro's 404. The
 * filter is applied again on every scan (dev add/unlink), so a file created after boot is
 * still refused without a restart.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Nitro, NitroEventHandler } from "nitro/types";
import type { Analysis } from "@facilis.dev/analyze";

import { analyzeProjectRoutes } from "./route-metadata.ts";

export interface SurfaceAllowlist {
  readonly routes: ReadonlySet<string>;
  readonly extensions: ReadonlySet<string>;
}

/** Project-relative path with forward slashes; null for a framework file. */
function projectRelative(rootDir: string, handler: string): string | null {
  // A config-provided path may be relative; resolving it stops a "\\./server/plugins/x.ts"
  // entry from looking like a framework path and skipping the allowlist.
  const absolute = isAbsolute(handler) ? handler : resolve(rootDir, handler);
  if (!absolute.startsWith(rootDir)) return null;
  const rel = relative(rootDir, absolute).split(sep).join("/");
  if (rel.length === 0 || rel.startsWith("..") || rel.startsWith("node_modules/")) return null;
  return rel;
}

function allowedProjectFile(rel: string, allowlist: SurfaceAllowlist): boolean {
  if (rel.startsWith("server/routes/") || rel.startsWith("server/api/")) {
    return allowlist.routes.has(rel);
  }
  if (
    rel.startsWith("server/middleware/") ||
    rel.startsWith("server/plugins/") ||
    rel.startsWith("server/modules/") ||
    rel.startsWith("server/tasks/")
  ) {
    return allowlist.extensions.has(rel);
  }
  // Any other project file is not a mountable surface: a handler/plugin configured from
  // outside the four declared directories is exactly the silent authority D-226 removes.
  return false;
}

function handlerAllowed(
  handler: NitroEventHandler,
  rootDir: string,
  allowlist: SurfaceAllowlist,
): boolean {
  const rel = projectRelative(rootDir, handler.handler);
  return rel === null || allowedProjectFile(rel, allowlist);
}

function filterHandlers(
  handlers: readonly NitroEventHandler[] | undefined,
  rootDir: string,
  allowlist: SurfaceAllowlist,
): NitroEventHandler[] {
  return (handlers ?? []).filter((handler) => handlerAllowed(handler, rootDir, allowlist));
}

function filterStrings(
  values: readonly string[] | undefined,
  rootDir: string,
  allowlist: SurfaceAllowlist,
): string[] | undefined {
  if (values === undefined) return undefined;
  const kept: string[] = [];
  for (const value of values) {
    const rel = projectRelative(rootDir, value);
    if (rel === null) {
      kept.push(value);
      continue;
    }
    if (allowedProjectFile(rel, allowlist)) {
      // Normalize an allowed relative config path so Nitro resolves it like a scanned one.
      kept.push(isAbsolute(value) ? value : resolve(rootDir, value));
    }
  }
  return kept;
}

/**
 * Apply the allowlist to the Nitro instance the module sees. `scannedHandlers` is assigned
 * by Nitro after each scan, so it is intercepted rather than filtered once: that is the only
 * seam between scanning and routing.sync() in Nitro v3 (pinned version).
 */
function allowlistFor(analysis: Analysis): SurfaceAllowlist {
  const routes = new Set(
    analysis.routes
      .filter((route) => route.surface.class === "standard" || route.surface.class === "declared")
      .map((route) => route.sourceFile),
  );
  // A route whose file imports a forbidden db factory is not mounted, even in dev: the
  // build gate already refuses it, and the mount must not run code the gate condemns.
  for (const entry of analysis.surface.forbiddenImports) routes.delete(entry.file);
  return {
    routes,
    extensions: new Set(
      analysis.surface.extensions
        .filter((extension) => extension.surface.class === "declared")
        .map((extension) => extension.file),
    ),
  };
}

export function enforceDeclaredSurface(
  nitro: Nitro,
  rootDir: string,
  analysis: Analysis,
  refresh: () => Analysis | undefined = () => analyzeProjectRoutes(rootDir),
): SurfaceAllowlist {
  const allowlist = allowlistFor(analysis);

  nitro.options.handlers = filterHandlers(nitro.options.handlers ?? [], rootDir, allowlist);

  const filteredPlugins = filterStrings(nitro.options.plugins, rootDir, allowlist);
  if (filteredPlugins !== undefined) nitro.options.plugins = filteredPlugins;

  // A module can be a path or an inline object; only path modules can be checked, so an
  // inline module is left to the config author (it is not a scanned project file).
  if (nitro.options.modules !== undefined) {
    nitro.options.modules = nitro.options.modules.filter((value) => {
      if (typeof value !== "string") return true;
      const rel = projectRelative(rootDir, value);
      return rel === null || allowedProjectFile(rel, allowlist);
    });
  }

  if (nitro.options.tasks !== undefined) {
    for (const [name, task] of Object.entries(nitro.options.tasks)) {
      const handler = task.handler;
      if (typeof handler !== "string") continue;
      const rel = projectRelative(rootDir, handler);
      if (rel !== null && !allowedProjectFile(rel, allowlist)) delete nitro.options.tasks[name];
    }
  }

  let current = filterHandlers(nitro.scannedHandlers, rootDir, allowlist);
  Object.defineProperty(nitro, "scannedHandlers", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: NitroEventHandler[]) => {
      // Dev rescans replace this list without re-running module setup. Re-analyze so a file
      // added or edited after boot is judged by the current source, not the boot snapshot:
      // a newly declared route mounts, an edit that drops the wrapper is refused (D-226).
      const fresh = refresh();
      current = filterHandlers(value, rootDir, fresh === undefined ? allowlist : allowlistFor(fresh));
    },
  });
  return allowlist;
}
