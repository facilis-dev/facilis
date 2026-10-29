import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Plugin } from "vite";
import type { NitroModule } from "nitro/types";
import { nitro } from "nitro/vite";

import { scanRouteMetadata } from "./ast/scanner.ts";
import { loadNitroOptions } from "./config.ts";
import { createFacilisNitroModule } from "./module.ts";
import type { FacilisOptions, RouteMetadataMap } from "./types.ts";
import { RESOLVED_OPENAPI_META_ID, VIRTUAL_OPENAPI_META_ID } from "./virtual-ids.ts";

type WarningSink = (message: string) => void;

export interface FacilisVitePlugin extends Plugin {
  /** The Nitro module Vite exposes on the plugin object (SPEC §5.6). */
  readonly nitro: NitroModule;
}

/**
 * `facilis()`'s return value: the framework plugin first, then Nitro's own Vite plugins.
 *
 * Nitro is mounted by `facilis()` so a project never imports `nitro/vite` itself and never
 * keeps a `nitro.config.ts` (D-034): its options come from `facilis.config.ts`.
 */
export type FacilisPlugins = [FacilisVitePlugin, ...Plugin[]];

/**
 * The Facilis Vite plugin (SPEC §5.6, Appendix E), plus the Nitro plugins it mounts.
 *
 * Three jobs: carry the Nitro module, deliver the project's Nitro options to Nitro, and own
 * the framework AST pass. The AST pass is a virtual module so route-file edits can be
 * invalidated through Vite's module graph and HMR keeps /_openapi.json and
 * /__facilis/manifest fresh (SPEC §6.9, contracts §8).
 */
export function facilis(options: FacilisOptions = {}): FacilisPlugins {
  let root = process.cwd();
  let routesDir: string | undefined;
  let cachedMetadata: RouteMetadataMap | undefined;

  const loadMetadata = async (warn?: WarningSink): Promise<RouteMetadataMap> => {
    if (cachedMetadata !== undefined) return cachedMetadata;
    if (routesDir === undefined) return {};
    cachedMetadata = await scanRouteMetadata({
      routesDir,
      rootDir: root,
      onWarning: (warning) => warn?.(warning.message),
    });
    return cachedMetadata;
  };

  const invalidate = (): void => {
    cachedMetadata = undefined;
  };

  const onRouteFileChanged = (file: string): boolean => {
    if (!isRouteFile(file, routesDir)) return false;
    invalidate();
    return true;
  };

  const plugin: FacilisVitePlugin = {
    name: "facilis",
    enforce: "pre",
    nitro: createFacilisNitroModule(),

    // Deliver the project's Nitro options through Vite's own `nitro` user-config key,
    // which is what Nitro's plugin reads. `enforce: "pre"` is what makes it work: config
    // hooks run in plugin order, so this one has already merged the `nitro` key into the
    // user config by the time nitro:init builds its Nitro instance. Nothing about the
    // project's plugins array (e.g. facilis() before react()) can change that.
    async config(userConfig) {
      const projectRoot = userConfig.root === undefined ? process.cwd() : resolve(userConfig.root);
      return { nitro: await loadNitroOptions(projectRoot) };
    },

    configResolved(config) {
      root = config.root;
      routesDir =
        options.routesDir === undefined
          ? resolve(config.root, "server", "routes")
          : resolve(config.root, options.routesDir);
    },

    // Warm the scan before the first request so a broken route file surfaces as a
    // warning during startup, not as a surprising slow first spec fetch.
    async buildStart() {
      const warn = (message: string): void => this.warn(message);
      await loadMetadata(warn);
    },

    configureServer(server) {
      if (routesDir === undefined || !existsSync(routesDir)) return;
      server.watcher.add(routesDir);
      // handleHotUpdate covers existing modules; add/unlink also need an invalidation
      // because a brand-new route file has no module-graph entry yet.
      server.watcher.on("all", (event, file) => {
        if (event !== "add" && event !== "unlink" && event !== "addDir") return;
        if (onRouteFileChanged(file)) invalidateOpenApiMetaModule(server);
      });
    },

    handleHotUpdate(context) {
      if (!onRouteFileChanged(context.file)) return;
      invalidateOpenApiMetaModule(context.server);
      // Returning void leaves the rest of the update pipeline (Nitro's own server
      // reload for route handlers) untouched.
    },

    resolveId(id) {
      if (id === VIRTUAL_OPENAPI_META_ID) return RESOLVED_OPENAPI_META_ID;
      return null;
    },

    async load(id) {
      if (id !== RESOLVED_OPENAPI_META_ID) return null;
      const metadata = await loadMetadata((message) => this.warn(message));
      return `export default ${JSON.stringify(metadata)};`;
    },
  };

  return [plugin, ...nitro()];
}

function isRouteFile(file: string, routesDir: string | undefined): boolean {
  if (routesDir === undefined) return false;
  const absolute = resolve(file);
  if (!absolute.startsWith(`${routesDir}${sep}`)) return false;
  return /\.(?:[cm]?[jt]sx?)$/.test(absolute);
}

/**
 * Invalidate the virtual metadata module in every environment that may have imported
 * it. Nitro's handlers live in an environment of their own, so the mixed (legacy)
 * module graph alone is not enough.
 */
function invalidateOpenApiMetaModule(server: {
  environments: Record<
    string,
    {
      moduleGraph:
        | {
            getModuleById(id: string): { id: string | null } | undefined;
            invalidateModule(mod: never): void;
          }
        | undefined;
    }
  >;
  moduleGraph: {
    getModuleById(id: string): { id: string | null } | undefined;
    invalidateModule(mod: never): void;
  };
}): void {
  for (const environment of Object.values(server.environments)) {
    const graph = environment.moduleGraph;
    if (graph === undefined) continue;
    const module = graph.getModuleById(RESOLVED_OPENAPI_META_ID);
    if (module !== undefined) graph.invalidateModule(module as never);
  }
  const legacy = server.moduleGraph.getModuleById(RESOLVED_OPENAPI_META_ID);
  if (legacy !== undefined) server.moduleGraph.invalidateModule(legacy as never);
}
