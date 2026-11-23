/**
 * The generated SSR entry for the prerender pass (D-202 Arm C). `prerender-engine.ts`
 * bundles this source with a second in-process Vite build (`ssr: true`, no config file —
 * the spike-proven shape) and imports the chunk in the same realm. The entry wires the
 * project's one route table (`src/app.tsx`, D-058) and its island provider into the
 * framework render runtime; nothing here ships in the client bundle.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** Virtual input id of the generated entry (resolved by `prerenderEntryPlugin`). */
export const PRERENDER_ENTRY_INPUT = "virtual:facilis-prerender-entry";
const RESOLVED_ENTRY_ID = "\0" + PRERENDER_ENTRY_INPUT;

/** The project's island provider convention (examples ship it; data pages require it). */
export const PRERENDER_PROVIDER_PATH = "src/lib/prerender.tsx";

export interface PrerenderEntryOptions {
  readonly root: string;
}

/**
 * Source of the SSR entry. Imports are absolute file paths so the bundle resolves the
 * project's modules and the framework runtime regardless of the consumer's node_modules
 * layout (workspace link or registry install, host or WebContainer VFS).
 */
export function prerenderEntrySource(options: PrerenderEntryOptions): string {
  // The package ships src (.ts) and dist (.js); pick the sibling extension we run from.
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const runtimePath = fileURLToPath(new URL(`./prerender-ssr-runtime${extension}`, import.meta.url));
  const appPath = resolve(options.root, "src/app.tsx");
  const providerPath = resolve(options.root, PRERENDER_PROVIDER_PATH);
  const hasProvider = existsSync(providerPath);
  const lines = [
    `import { renderPrerenderRoute } from ${JSON.stringify(runtimePath)};`,
    `import { App } from ${JSON.stringify(appPath)};`,
  ];
  if (hasProvider) {
    lines.push(`import { PrerenderDataProvider } from ${JSON.stringify(providerPath)};`);
  }
  lines.push(
    "export function render(route, data) {",
    `  return renderPrerenderRoute({ route, data, app: App${hasProvider ? ", provider: PrerenderDataProvider" : ""} });`,
    "}",
  );
  return lines.join("\n") + "\n";
}

/** Resolve/load the virtual entry inside the SSR sub-build only. */
export function prerenderEntryPlugin(source: string): Plugin {
  return {
    name: "facilis:prerender-entry",
    resolveId(id) {
      if (id === PRERENDER_ENTRY_INPUT) return RESOLVED_ENTRY_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_ENTRY_ID) return source;
      return null;
    },
  };
}
