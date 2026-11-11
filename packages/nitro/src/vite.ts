import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import type { NitroModule } from "nitro/types";
import { nitro } from "nitro/vite";

import type { Analysis } from "@facilis.dev/analyze";

import { loadNitroOptions } from "./config.ts";
import { createFacilisNitroModule } from "./module.ts";
import { analyzeProjectRoutes, routeMetadataFromAnalysis } from "./route-metadata.ts";
import type { RouteMetadataMap } from "./types.ts";
import { RESOLVED_OPENAPI_META_ID, VIRTUAL_OPENAPI_META_ID } from "./virtual-ids.ts";

type WarningSink = (message: string) => void;

/** Extensions the analyzer reads; a change to any of them can change the route facts. */
const PROJECT_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|json)$/;
/** Directories the analyzer skips (its ALWAYS_SKIPPED set plus node_modules). */
const IGNORED_SEGMENTS: ReadonlySet<string> = new Set([
  ".facilis",
  ".git",
  ".output",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

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
 * the framework route-metadata pass. The pass is a virtual module so project edits can be
 * invalidated through Vite's module graph and HMR keeps /_openapi.json and
 * /__facilis/manifest fresh (SPEC §6.9, contracts §8).
 */
export function facilis(): FacilisPlugins {
  let root = process.cwd();
  // One analysis per revision of the project: the mapping is cheap, the analyzer is not.
  let analysis: Analysis | undefined;
  let metadata: RouteMetadataMap | undefined;

  const loadMetadata = (warn?: WarningSink): RouteMetadataMap => {
    if (metadata !== undefined) return metadata;
    analysis ??= analyzeProjectRoutes(root);
    metadata =
      analysis === undefined
        ? {}
        : routeMetadataFromAnalysis(analysis, (warning) => warn?.(warning.message));
    return metadata;
  };

  const invalidate = (): void => {
    analysis = undefined;
    metadata = undefined;
  };

  // The analyzer reads facilis.config.ts and any project module a route config imports
  // (D-092), so every project source file can change the route facts, not just routes.
  const onProjectSourceChanged = (file: string): boolean => {
    if (!isProjectSourceFile(file, root)) return false;
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
    },

    // Warm the analysis before the first request so a broken route file surfaces as a
    // warning during startup, not as a surprising slow first spec fetch.
    async buildStart() {
      loadMetadata((message) => this.warn(message));
    },

    configureServer(server) {
      // handleHotUpdate covers changed modules; add/unlink also need an invalidation
      // because a brand-new or deleted project file may have no module-graph entry yet.
      server.watcher.on("all", (event, file) => {
        if (event !== "add" && event !== "unlink" && event !== "addDir") return;
        if (!onProjectSourceChanged(file)) return;
        invalidateOpenApiMetaModule(server);
      });
    },

    handleHotUpdate(context) {
      if (!onProjectSourceChanged(context.file)) return;
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
      return `export default ${JSON.stringify(loadMetadata((message) => this.warn(message)))};`;
    },
  };

  return [plugin, ...nitro()];
}

/** True for a file the analyzer reads, excluding generated and dependency directories. */
function isProjectSourceFile(file: string, root: string): boolean {
  const projectRelative = relative(root, resolve(file));
  if (projectRelative.length === 0 || isAbsolute(projectRelative)) return false;
  const segments = projectRelative.split(sep);
  if (segments[0] === "..") return false;
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return false;
  return PROJECT_FILE_PATTERN.test(projectRelative);
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
